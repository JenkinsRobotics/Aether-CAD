/** Evaluate the authored Scifirobot document with the Aether engine and write the gallery's
 *  pre-evaluated rollback meshes, STEP and proof. The gallery receives generated meshes only;
 *  every rollback tip is evaluated, never reconstructed. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initNodeKernel, solidMeasures } from '../../../aether-engine/src/kernel/node-kernel';
import { evaluatePartDocument } from '../../../aether-engine/src/kernel/part-evaluator';
import { exportPart } from '../../../aether-engine/src/kernel/export';
import type { PartDocument } from '../../../aether-engine/src/document/part-document';

// Run from the Aether-CAD checkout (the bundle runs from a scratch directory).
const here = process.env.AETHER_SCIFIROBOT_DIR ?? resolve('scripts/examples/scifirobot');
const source = join(here, 'generated');
const destination = process.argv[2] ? resolve(process.argv[2]) : source;
mkdirSync(destination, { recursive: true });
await initNodeKernel(readFileSync(resolve(here, '..', '..', '..', 'aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm')));

const presentation = JSON.parse(readFileSync(join(source, 'presentation.json'), 'utf8'));
const document: PartDocument = JSON.parse(readFileSync(join(source, 'Scifirobot.part.json'), 'utf8'));
const owner: Record<string, string> = Object.fromEntries(presentation.features.map((row: { id: string; bodyID: string }) => [row.id, row.bodyID]));
const metadata: Record<string, { id: string; tips?: { featureID: string; mesh: string }[] }> = Object.fromEntries(presentation.bodies.map((row: { id: string }) => [row.id, row]));
const meshes: Record<string, { vertices: number[]; normals: number[]; triangles: number[] }> = {};
const proof: { featureID: string; bodyID: string; volume_mm3: number; faces: number }[] = [];

type Built = { parts: { id: string; vertices: Float32Array; normals: Float32Array; triangles: Uint32Array }[]; measures: Map<string, ReturnType<typeof solidMeasures>>; milliseconds: number };
function evaluated(features: PartDocument['features'], id: string): Built {
  const measures = new Map<string, ReturnType<typeof solidMeasures>>();
  const started = performance.now();
  const model = evaluatePartDocument({ ...document, documentId: id, features }, { withBodies: (bodies) => { for (const [bodyId, shape] of bodies) measures.set(bodyId, solidMeasures(shape)); } });
  for (const [bodyId, m] of measures) if (!(m.volume_mm3 > 0)) throw new Error(`${bodyId}: nonpositive volume`);
  return { parts: model.parts, measures, milliseconds: performance.now() - started };
}
const pack = (part: Built['parts'][number]) => ({ vertices: Array.from(part.vertices, (x) => Math.round(x) / 1000), normals: Array.from(part.normals, (x) => Math.round(x * 1e6) / 1e6), triangles: Array.from(part.triangles) });

const full = evaluated(document.features, 'scifirobot-full');
const bodyIds = new Set(full.parts.map((p) => p.id));
if ([...bodyIds].sort().join() !== Object.keys(metadata).sort().join()) throw new Error(`bodies differ: ${[...bodyIds].join(',')}`);
console.log(`Full engine rebuild: ${full.parts.length} solids in ${(full.milliseconds / 1000).toFixed(2)}s`);
// Each body is independently authored: evaluate its successive tips for exact rollback previews.
for (const bodyId of Object.keys(metadata)) {
  const own = document.features.filter((f) => owner[f.id] === bodyId);
  const tips: { featureID: string; mesh: string }[] = [];
  let last: Built | undefined;
  own.forEach((feature, i) => {
    if (feature.type === 'profile' || feature.type === 'sketch') return;
    last = evaluated(own.slice(0, i + 1), `scifirobot-${bodyId}`);
    if (last.parts.length !== 1 || last.parts[0].id !== bodyId) throw new Error(`${bodyId}: tip ${feature.id} built ${last.parts.map((p) => p.id).join(',')}`);
    meshes[feature.id] = pack(last.parts[0]);
    tips.push({ featureID: feature.id, mesh: feature.id });
    const m = last.measures.get(bodyId)!;
    proof.push({ featureID: feature.id, bodyID: bodyId, volume_mm3: m.volume_mm3, faces: m.face_count });
  });
  const final = full.measures.get(bodyId)!, tip = last!.measures.get(bodyId)!;
  if (Math.abs(final.volume_mm3 - tip.volume_mm3) > 1e-8 * final.volume_mm3) throw new Error(`${bodyId}: final volume differs from its last tip`);
  metadata[bodyId].tips = tips;
  console.log(`${bodyId}: ${tips.length} evaluated tips`);
}
// The circular sketch stays a geometric input: a radius edit changes the exact volume as expected.
const lens = document.features.filter((f) => owner[f.id] === 'lens').slice(0, 2);
const base = evaluated(lens, 'scifirobot-lens').measures.get('lens')!.volume_mm3;
const edited = structuredClone(lens) as typeof lens;
const circle = (edited[0] as { profile: { radiusMillimeters: number } }).profile; const radius = circle.radiusMillimeters; circle.radiusMillimeters = radius + 10;
const changed = evaluated(edited, 'scifirobot-lens-edit').measures.get('lens')!.volume_mm3;
const height = (lens[1] as { distanceMillimeters: number }).distanceMillimeters;
if (Math.abs((changed - base) - Math.PI * ((radius + 10) ** 2 - radius ** 2) * height) > 1e-8 * changed) throw new Error('radius edit volume mismatch');
console.log('Sketch-radius edit changes the exact solid volume as expected');
const step = await exportPart(document, { format: 'step', bodyIds: null, toleranceMillimeters: 0.1 });
writeFileSync(join(destination, 'Scifirobot.step'), Buffer.from(step.bytes));
const manifest = { format: 'aether-generated-model-preview', version: 1, source: 'Scifirobot.part.json', engine: 'Aether', features: presentation.features, bodies: Object.values(metadata) };
writeFileSync(join(destination, 'manifest.ts'), '// Generated by Aether-CAD/scripts/examples/scifirobot; do not hand-edit.\nexport const scifirobotFeatureModel = ' + JSON.stringify(manifest) + ' as const;\n');
writeFileSync(join(destination, 'meshes.json'), JSON.stringify(meshes));
writeFileSync(join(destination, 'Scifirobot.part.json'), JSON.stringify(document, null, 2));
// `generated/proof.json` keeps FreeCAD's recorded tips (the engine test's reference); this run's proof goes with the export.
writeFileSync(join(destination, 'proof.json'), JSON.stringify({ engine: 'Aether', solids: full.parts.length, features: document.features.length, tips: proof }, null, 2));
console.log(`Exported verified CAD document, STEP, and ${Object.keys(meshes).length} rollback meshes to ${destination}`);
