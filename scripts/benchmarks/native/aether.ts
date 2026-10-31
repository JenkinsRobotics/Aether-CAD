import { readFileSync, writeFileSync } from 'node:fs';
import { initNodeKernel, solidMeasures } from '../../../aether-engine/src/kernel/node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from '../../../aether-engine/src/kernel/part-evaluator';
import type { PartDocument } from '../../../aether-engine/src/document';
import type { EvaluationTiming } from '../../../aether-engine/src/kernel/evaluation-timing';
import type { Shape3D } from 'replicad';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const document: PartDocument = input.document ?? input;
const init = performance.now();
await initNodeKernel(readFileSync('aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm'));
const initMs = performance.now() - init;
const runs = [];
for (let round = 0; round < Number(process.env.BENCH_RUNS ?? 5); round++) {
  resetEvaluationCache();
  const phases = [];
  for (const phase of ['cold', 'repeat', 'edit'] as const) {
    const doc = structuredClone(document);
    if (phase === 'edit') {
      const edit = input.edit;
      const feature = doc.features.find(f => f.id === edit.featureId);
      if (!feature) throw new Error('Missing benchmark edit feature');
      Object.assign(feature, { [edit.field]: edit.value });
    }
    const events: EvaluationTiming[] = [];
    let solidMs = 0;
    let bodies: ReadonlyMap<string, Shape3D> = new Map();
    const start = performance.now();
    const result = evaluatePartDocument(doc, { observe: e => events.push(e), withBodies: b => { solidMs = performance.now() - start; bodies = b; } });
    const totalMs = performance.now() - start;
    const measures = [...bodies.values()].map(solidMeasures);
    if (phase === 'cold' && input.expectedVolume !== undefined && (measures.length !== 1 || Math.abs(measures[0].volume_mm3 - input.expectedVolume) > 1e-5)) throw new Error('Fixture geometry does not match its analytic volume');
    phases.push({ phase, totalMs, solidMs, displayMs: events.filter(e => e.phase === 'display').reduce((sum,e)=>sum+e.milliseconds,0), replayed: result.replayedFeatures,
      measures, triangles: result.parts.reduce((n,p)=>n+p.triangles.length/3,0), events });
  }
  runs.push({ round, phases });
}
const output = { engine: 'Aether OCCT WASM / Node', node: process.version, initMs, document: document.name, features: document.features.length, runs };
writeFileSync(process.argv[3], JSON.stringify(output,null,2));
console.log(JSON.stringify({document:document.name,initMs,runs:runs.map(r=>({round:r.round,phases:r.phases.map(({events,...p})=>p)}))}));
resetEvaluationCache();
