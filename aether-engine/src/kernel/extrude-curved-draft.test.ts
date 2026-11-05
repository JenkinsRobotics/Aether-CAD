import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, measureVolume, measureDistanceBetween, makeVertex, type Shape3D } from 'replicad';
import { evaluatePartDocument } from './part-evaluator';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, type ExtrudeFeature, type PartDocument } from '../document/index';
import { add, cross, dot, scale, sub, unit } from './vector';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);

// Independent envelope calculation. At height z each tangent support plane
// has h(phi)=R-k(phi)z. Its enclosed area is 1/2 integral(h²-h'²).
// Integrating that quadratic area gives the volume, independently of a loft.
export function circleVolume(radius: number, height: number, degrees: number) {
  const sine = Math.sin(degrees * Math.PI / 180), x = .6, z = .8, denom = z * z - sine * sine;
  let integralK = 0, integralQ = 0;
  const count = 4096, step = 2 * Math.PI / count;
  for (let i = 0; i < count; i++) {
    const p = i * step, q = x * Math.cos(p), root = Math.sqrt(z * z + q * q - sine * sine);
    const k = (-q * z + sine * root) / denom;
    const derivative = (-z + sine * q / root) * (-x * Math.sin(p)) / denom;
    integralK += k * step; integralQ += (k * k - derivative * derivative) * step;
  }
  return Math.PI * radius * radius * height - radius * height * height / 2 * integralK + height ** 3 / 6 * integralQ;
}
function fixture(changes: Partial<ExtrudeFeature> = {}) {
  const doc = createEmptyPartDocument('Curved angled draft');
  doc.features = [{ id: 's', name: 'Sketch', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [{ id: 'circle', type: 'circle', center: [0, 0], radius: 10 }] } },
    { id: 'e', name: 'Extrude', type: 'extrude', profileFeatureId: 's', bodyId: 'body', operation: 'new', suppressed: false,
      distanceMillimeters: 10, directionVector: [.6, 0, .8], draftAngleDegrees: 3, ...changes }];
  return doc;
}
function volume(doc: PartDocument, inspect?: (body: Shape3D) => void) {
  let result = 0;
  evaluatePartDocument(doc, { withBodies: bodies => { const body = bodies.get('body')!; result = measureVolume(body); inspect?.(body); } });
  return result;
}

it.each([3, -3])('authors and reopens the exact requested %s degree angled circular draft', angle => {
  for (const reversed of [false, true]) {
    const doc = fixture({ draftAngleDegrees: angle, reversed, startingOffsetMillimeters: 2 }), saved = serializePartDocument(doc);
    const expected = circleVolume(10, 9.6, angle) - circleVolume(10, 1.6, angle);
    expect(volume(doc)).toBeCloseTo(expected, 4);
    expect(volume(parsePartDocument(saved))).toBeCloseTo(expected, 4);
    expect(serializePartDocument(doc)).toBe(saved);
  }
}, 30000);

it('authors circular Thin walls with analytic volume', () => {
  const doc = fixture({ profileContourId: 'circle', thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 } });
  expect(volume(doc)).toBeCloseTo(circleVolume(12, 8, 3) - circleVolume(9, 8, -3), 4);
});

it('authors symmetric curved draft with analytic volume', () => {
  expect(volume(fixture({ endType: 'symmetric' }))).toBeCloseTo(2 * circleVolume(10, 4, 3), 4);
}, 30000);

it('authors independently drafted opposite ends with analytic volume', () => {
  expect(volume(fixture({ secondEnd: { endType: 'blind', distanceMillimeters: 4, draftAngleDegrees: -5 } })))
    .toBeCloseTo(circleVolume(10, 8, 3) + circleVolume(10, 3.2, -5), 4);
}, 30000);

it('keeps curved draft invariant when the sketch and pull are rotated together', () => {
  const doc = fixture({ directionVector: [.8, .6, 0] });
  doc.features[0] = { ...doc.features[0], plane: 'YZ' } as PartDocument['features'][number];
  expect(volume(doc)).toBeCloseTo(circleVolume(10, 8, 3), 4);
});

it('places the shared draft orbit on the native curved wall', () => {
  for (const angle of [3, -3]) {
    const doc = fixture({ draftAngleDegrees: angle });
    const handle = evaluatePartDocument(doc, { preview: true }).previewHandles!.find(h => h.parameter === 'draftAngle')!;
    const baseline = unit(sub(handle.startMillimeters!, handle.originMillimeters));
    const a = Math.abs(angle) * Math.PI / 180;
    const radial = add(scale(baseline, Math.cos(a)), scale(cross(handle.direction, baseline), Math.sin(a)));
    expect(dot(radial, [.6, 0, .8])).toBeCloseTo(Math.cos(a), 7);
    volume(doc, body => {
      const vertex = makeVertex(add(handle.originMillimeters, scale(radial, 3)));
      try { expect(measureDistanceBetween(vertex, body)).toBeLessThan(1e-6); }
      finally { vertex.delete(); }
    });
  }
});

it('rejects intersecting Thin walls without changing the authored feature', () => {
  const doc = fixture({ distanceMillimeters: 50, profileContourId: 'circle', thin: { thickness1Millimeters: 1, thickness2Millimeters: 1 } });
  const saved = serializePartDocument(doc);
  expect(() => volume(doc)).toThrow(/collaps|intersect|solid/i);
  expect(serializePartDocument(doc)).toBe(saved);
});

it.each(['up-to-face', 'up-to-vertex', 'up-to-part', 'up-to-next'] as const)('keeps curved native draft at %s with shifted start and end offset', endType => {
  const doc = fixture({ endType, endOffsetMillimeters: 1, startingOffsetMillimeters: 2,
    endReference: endType === 'up-to-face' ? { sourceFeatureId: 'limit', bodyId: 'stop', normal: [0, 0, -1], label: 'Stop' } : undefined,
    endPartId: endType === 'up-to-part' ? 'stop' : undefined,
    endPointReference: endType === 'up-to-vertex' ? { kind: 'sketch-point', sourceFeatureId: 'ls', contourId: 'lc', point: 'center', label: 'Stop point' } : undefined });
  doc.features.unshift({ id: 'ls', name: 'Stop sketch', type: 'profile', plane: 'XY', offsetMillimeters: 8, suppressed: false,
    profile: { type: 'drawing', contours: [{ id: 'lc', type: 'circle', center: [0, 0], radius: 30 }] } },
    { id: 'limit', name: 'Limit', type: 'extrude', profileFeatureId: 'ls', distanceMillimeters: 5, bodyId: 'stop', operation: 'new', suppressed: false });
  expect(volume(doc)).toBeCloseTo(circleVolume(10, 7.2, 3) - circleVolume(10, 1.6, 3), 4);
}, 30000);

it.each(['add', 'cut', 'intersect'] as const)('uses the native curved tool for %s with explicit target identity', operation => {
  const doc = fixture({ operation, reversed: operation === 'cut', targetBodyId: 'base', targetBodyIds: ['base'] });
  doc.features.unshift({ id: 'base-s', name: 'Base circle', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'circle', radiusMillimeters: 40, centerMillimeters: [0, 0] } },
    { id: 'base-e', name: 'Base extrusion', type: 'extrude', profileFeatureId: 'base-s', distanceMillimeters: 8,
      bodyId: 'base', operation: 'new', suppressed: false });
  const full = Math.PI * 40 ** 2 * 8, tool = circleVolume(10, 8, 3);
  evaluatePartDocument(doc, { withBodies: bodies => {
    expect([...bodies.keys()]).toEqual(['base']);
    expect(measureVolume(bodies.get('base')!)).toBeCloseTo(operation === 'add' ? full : operation === 'cut' ? full - tool : tool, 4);
  } });
}, 30000);

it('keeps all three tilted stopping modes on the same native plane', () => {
  const slope = .2, c = 1 / Math.hypot(1, slope), values: number[] = [];
  for (const endType of ['up-to-face', 'up-to-part', 'up-to-next'] as const) {
    const doc = fixture({ endType,
      endPartId: endType === 'up-to-part' ? 'stop' : undefined,
      endReference: endType === 'up-to-face' ? { sourceFeatureId: 'limit', bodyId: 'stop', normal: [slope * c, 0, -c], label: 'Tilted stop' } : undefined });
    doc.features.unshift({ id: 'ls', name: 'Tilted stop sketch', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
      frame: { originMillimeters: [0, 0, 8], normal: [-slope * c, 0, c], xDirection: [c, 0, slope * c] },
      profile: { type: 'circle', centerMillimeters: [0, 0], radiusMillimeters: 40 } },
      { id: 'limit', name: 'Limit', type: 'extrude', profileFeatureId: 'ls', distanceMillimeters: 5, bodyId: 'stop', operation: 'new', suppressed: false });
    values.push(volume(doc, body => {
      const faces = body.faces;
      try {
        const caps = faces.filter(face => face.geomType === 'PLANE');
        expect(caps).toHaveLength(2);
        const end = caps.find(face => { const center = face.center; try { return center.z > 1; } finally { center.delete(); } })!;
        expect(end).toBeDefined();
        const edges = end.edges;
        try { for (const edge of edges) for (const u of [0, .5, 1]) {
          const p = edge.pointAt(u);
          try { expect(p.z - slope * p.x).toBeCloseTo(8, 6); }
          finally { p.delete(); }
        } } finally { edges.forEach(edge => edge.delete()); }
      } finally { faces.forEach(face => face.delete()); }
    }));
  }
  expect(values[0]).toBeGreaterThan(circleVolume(10, 8, 3));
  expect(values[1]).toBeCloseTo(values[0], 4);
  expect(values[2]).toBeCloseTo(values[0], 4);
}, 30000);
