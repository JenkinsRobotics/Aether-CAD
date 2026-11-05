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
