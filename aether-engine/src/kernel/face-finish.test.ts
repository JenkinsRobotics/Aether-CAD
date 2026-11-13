import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, getOC, measureVolume } from 'replicad';
import { evaluatePartDocument, resetEvaluationCache } from './part-evaluator';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, type PartFeature } from '../document/index';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const fixture = () => ({ ...createEmptyPartDocument('Quarter-revolved tapered flange'), features: [
  { id: 's', name: 'Sketch', type: 'profile', plane: 'XZ', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'polygon', pointsMillimeters: [[0,10],[0,150],[35,150],[40,120],[120,116.5],[120,100],[45,100],[45,70],[70,70],[70,10]] } },
  { id: 'r', name: 'Revolve', type: 'revolve', profileFeatureId: 's', axis: 'X', angleDegrees: 90, operation: 'new', suppressed: false },
] as PartFeature[] });

for (const type of ['fillet', 'chamfer'] as const) for (const radius of [.254, .508, 1.5]) it(`${type} on every boundary of either tapered face at ${radius} mm and preserves editable rebuild`, () => {
  const doc = fixture(), before = serializePartDocument(doc), body = evaluatePartDocument(doc).parts[0];
  for (const face of body.topology.filter(f => f.surfaceType === 'CONE')) {
    const edges = face.candidates.filter(c => c.kind === 'edge-midpoint');
    expect(edges).toHaveLength(4);
    const edited = { ...doc, features: [...doc.features, {
      id: 'f', name: type, type, suppressed: false, radiusMillimeters: radius, targetBodyId: body.id, tangentChain: true,
      edges: [{ kind: 'face-edges', sourceFeatureId: 'r', bodyId: body.id, label: 'Tapered face', surfaceType: 'cone', faceAnchor: { centerMillimeters: face.measurements!.centerMillimeters, areaSquareMillimeters: face.measurements!.areaSquareMillimeters } }],
    } as PartFeature] };
    let volume = 0;
    const check = (d: typeof doc) => evaluatePartDocument(d, { withBodies: bodies => {
      expect(bodies.size).toBe(1);
      for (const b of bodies.values()) {
        const analyzer = new (getOC().BRepCheck_Analyzer)(b.wrapped, true, false);
        try { expect(analyzer.IsValid_2()).toBe(true); } finally { analyzer.delete(); }
        const v = measureVolume(b); expect(v).toBeGreaterThan(1e6); expect(v).toBeLessThan(1.2e6);
        if (volume) expect(v).toBeCloseTo(volume, 5); else volume = v;
      }
    } });
    const result = check(edited).parts[0];
    const remaining = result.topology.flatMap(f => f.candidates).filter(c => c.kind === 'edge-midpoint');
    // No requested sharp boundary may be silently left behind.
    for (const edge of edges) expect(remaining.some(c => Math.hypot(...c.origin.map((v,i)=>v-edge.origin[i]))<1e-5 && Math.abs(c.measurements!.lengthMillimeters!-edge.measurements!.lengthMillimeters!)<1e-5)).toBe(false);
    resetEvaluationCache(); check(parsePartDocument(serializePartDocument(edited)));
  }
  expect(serializePartDocument(doc)).toBe(before);
});

// Jonathan, 2026-11-13: Onshape builds a 0.05 in (1.27 mm) distance-and-angle chamfer on faces of a
// revolve; Aether refused it as an invalid shape. A face pick expands to edges that share no
// single neighbour, so each edge needs its own first-leg face, and corners need the same
// ordered recovery as the equal-distance chamfer.
const validSolid = (d: ReturnType<typeof fixture>) => {
  let checked = 0;
  evaluatePartDocument(d, { withBodies: bodies => { for (const b of bodies.values()) {
    const analyzer = new (getOC().BRepCheck_Analyzer)(b.wrapped, true, false);
    try { expect(analyzer.IsValid_2()).toBe(true); checked++; } finally { analyzer.delete(); }
  } } });
  expect(checked).toBe(1);
};
const faceRef = (face: { surfaceType: string; measurements?: { centerMillimeters?: unknown; areaSquareMillimeters?: unknown } }, bodyId: string) => ({
  kind: 'face-edges', sourceFeatureId: 'r', bodyId, label: 'Face of Revolve', surfaceType: face.surfaceType.toLowerCase(),
  faceAnchor: { centerMillimeters: face.measurements!.centerMillimeters, areaSquareMillimeters: face.measurements!.areaSquareMillimeters },
});
const angledChamfer = (doc: ReturnType<typeof fixture>, bodyId: string, faces: Parameters<typeof faceRef>[0][]) => ({ ...doc, features: [...doc.features, {
  id: 'c', name: 'Chamfer', type: 'chamfer', suppressed: false, radiusMillimeters: 1.27, angleDegrees: 45, targetBodyId: bodyId, tangentChain: true,
  edges: faces.map(face => faceRef(face, bodyId)),
} as PartFeature] });

it('distance-and-angle chamfer of 0.05 in on each curved face of a revolve is a valid solid', () => {
  const doc = fixture(), body = evaluatePartDocument(doc).parts[0];
  const curved = body.topology.filter(f => f.surfaceType !== 'PLANE');
  expect(curved.length).toBeGreaterThan(3);
  for (const face of curved) validSolid(angledChamfer(doc, body.id, [face]));
});

it('one distance-and-angle chamfer takes both tapered faces of a revolve', () => {
  const doc = fixture(), body = evaluatePartDocument(doc).parts[0];
  const cones = body.topology.filter(f => f.surfaceType === 'CONE');
  expect(cones).toHaveLength(2);
  validSolid(angledChamfer(doc, body.id, cones));
});

it('Sketch → Revolve → Fillet → one distance-and-angle chamfer on both tapered faces builds', () => {
  const doc = fixture(), body = evaluatePartDocument(doc).parts[0];
  const bore = body.topology.find(f => f.surfaceType === 'CYLINDER' && Math.abs(f.measurements!.centerMillimeters![0] - 35) < 1e-6)!;
  const filleted = { ...doc, features: [...doc.features, {
    id: 'f', name: 'Fillet', type: 'fillet', suppressed: false, radiusMillimeters: 2, targetBodyId: body.id, tangentChain: true, edges: [faceRef(bore, body.id)],
  } as PartFeature] };
  const result = evaluatePartDocument(filleted).parts[0];
  validSolid(angledChamfer(filleted, result.id, result.topology.filter(f => f.surfaceType === 'CONE')));
}, 60000);

it('distance-and-angle chamfer on a full-revolve face skips its seam and builds', () => {
  const doc = { ...createEmptyPartDocument('Full revolve'), features: [fixture().features[0],
    { id: 'r', name: 'Revolve', type: 'revolve', profileFeatureId: 's', axis: 'X', angleDegrees: 360, operation: 'new', suppressed: false }] as PartFeature[] };
  const body = evaluatePartDocument(doc).parts[0];
  const cones = body.topology.filter(f => f.surfaceType === 'CONE');
  expect(cones).toHaveLength(2);
  for (const cone of cones) validSolid(angledChamfer(doc, body.id, [cone]));
});
