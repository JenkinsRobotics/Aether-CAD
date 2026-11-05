import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, measureVolume, measureDistanceBetween, makeVertex, type Shape3D } from 'replicad';
import { evaluatePartDocument } from './part-evaluator';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, type ExtrudeFeature, type PartFeature } from '../document/index';
import { add, cross, dot, scale, sub, unit } from './vector';

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) }));
}, 30000);

function fixture(changes: Partial<ExtrudeFeature> = {}) {
  const doc = createEmptyPartDocument('Angled native draft');
  doc.features.push(
    { id: 's', name: 'Sketch', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
      profile: { type: 'drawing', contours: [{ id: 'outline', type: 'path', start: [-10, -5],
        segments: [[10, -5], [10, 5], [-10, 5], [-10, -5]].map(end => ({ type: 'line', end })) }] } } as PartFeature,
    { id: 'e', name: 'Extrude', type: 'extrude', profileFeatureId: 's', bodyId: 'body', operation: 'new', suppressed: false,
      distanceMillimeters: 10, directionVector: [.6, 0, .8], draftAngleDegrees: 3, ...changes },
  );
  return doc;
}

// Independent closed-form sections: left/right sides lean at theta +/- draft;
// front/back planes satisfy sin(draft) = .8 * sin(their tilt from vertical).
function integral(z: number, degrees: number, width = 20, height = 10) {
  const a = degrees * Math.PI / 180, theta = Math.atan2(.6, .8);
  const wx = Math.tan(theta + a) - Math.tan(theta - a);
  const wy = 2 * Math.sin(a) / Math.sqrt(.8 * .8 - Math.sin(a) ** 2);
  return width * height * z - (width * wy + height * wx) * z * z / 2 + wx * wy * z ** 3 / 3;
}
function volume(doc: ReturnType<typeof fixture>, inspect?: (body: Shape3D) => void) {
  let result = 0;
  evaluatePartDocument(doc, { withBodies: bodies => {
    const body = bodies.get('body')!;
    result = measureVolume(body); inspect?.(body);
  } });
  return result;
}

it.each([3, -3, 15])('drafts angled planar walls at exactly %s degrees and survives saved reopen', angle => {
  for (const reversed of [false, true]) {
    const doc = fixture({ draftAngleDegrees: angle, reversed, startingOffsetMillimeters: 2 });
    const before = serializePartDocument(doc);
    expect(volume(doc, body => {
      const faces = body.faces;
      try {
        const normals = faces.map(face => { const n = face.normalAt(); try { return unit(n.toTuple()); } finally { n.delete(); } });
        const sides = normals.filter(n => Math.abs(n[2]) < 1 - 1e-7);
        expect(sides).toHaveLength(4);
        for (const normal of sides) expect(dot(normal, reversed ? [-.6, 0, -.8] : [.6, 0, .8])).toBeCloseTo(Math.sin(angle * Math.PI / 180), 7);
      } finally { faces.forEach(face => face.delete()); }
    })).toBeCloseTo(integral(9.6, angle) - integral(1.6, angle), 5);
    expect(volume(parsePartDocument(before))).toBeCloseTo(volume(doc), 6);
    expect(serializePartDocument(doc)).toBe(before);
  }
});

it.each([3, -3])('drafts angled closed Thin walls at %s degrees with exact inner and outer boundaries', angle => {
  const doc = fixture({ draftAngleDegrees: angle, startingOffsetMillimeters: 2,
    profileContourId: 'outline', thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 } });
  const expected = (z: number) => integral(z, angle, 24, 14) - integral(z, -angle, 18, 8);
  expect(volume(doc)).toBeCloseTo(expected(9.6) - expected(1.6), 5);
});

it('retains separate symmetric and independent opposite draft extents', () => {
  expect(volume(fixture({ endType: 'symmetric' }))).toBeCloseTo(2 * integral(4, 3), 5);
  expect(volume(fixture({ secondEnd: { endType: 'blind', distanceMillimeters: 4, draftAngleDegrees: -5 } })))
    .toBeCloseTo(integral(8, 3) + integral(3.2, -5), 5);
});

it('places the shared angular orbit on the actual drafted wall and keeps its angle from the pull', () => {
  for (const angle of [3, -3]) {
    const doc = fixture({ draftAngleDegrees: angle });
    const handle = evaluatePartDocument(doc, { preview: true }).previewHandles!.find(h => h.parameter === 'draftAngle')!;
    const baseline = unit(sub(handle.startMillimeters!, handle.originMillimeters));
    const a = Math.abs(angle) * Math.PI / 180;
    const radial = add(scale(baseline, Math.cos(a)), scale(cross(handle.direction, baseline), Math.sin(a)));
    expect(dot(radial, [.6, 0, .8])).toBeCloseTo(Math.cos(a), 7);
    volume(doc, body => {
      const faces = body.faces;
      try {
        const wall = faces.find(face => {
          const n = face.normalAt(), c = face.center;
          try { return Math.abs(n.z) < .99 && Math.abs(dot(n.toTuple(), sub(handle.originMillimeters, c.toTuple()))) < 1e-6; }
          finally { n.delete(); c.delete(); }
        });
        expect(wall).toBeDefined();
        const normal = wall!.normalAt();
        try { expect(dot(unit(normal.toTuple()), radial)).toBeCloseTo(0, 7); }
        finally { normal.delete(); }
      } finally { faces.forEach(face => face.delete()); }
    });
  }
});

it('keeps both thickness arrows on the shifted oblique draft at the actual start', () => {
  const doc = fixture({ startingOffsetMillimeters: 2, profileContourId: 'outline', thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 } });
  const handles = evaluatePartDocument(doc, { preview: true }).previewHandles!;
  volume(doc, body => {
    for (const [parameter, thickness] of [['thickness1', 2], ['thickness2', 1]] as const) {
      const h = handles.find(h => h.parameter === parameter)!;
      const point = add(h.originMillimeters, scale(h.direction, thickness));
      expect(point[2]).toBeCloseTo(1.6, 7);
      const vertex = makeVertex(point);
      try { expect(measureDistanceBetween(vertex, body)).toBeLessThan(1e-6); }
      finally { vertex.delete(); }
    }
  });
});

it.each(['up-to-face', 'up-to-part', 'up-to-next', 'up-to-vertex'] as const)('terminates angled walls at %s with an end offset, with and without draft', endType => {
  for (const draftAngleDegrees of [0, 3]) {
  const doc = fixture({ endType, endOffsetMillimeters: 1, startingOffsetMillimeters: 2, draftAngleDegrees,
    endReference: endType === 'up-to-face' ? { sourceFeatureId: 'limit', bodyId: 'limitBody', normal: [0, 0, -1], label: 'Stop' } : undefined,
    endPartId: endType === 'up-to-part' ? 'limitBody' : undefined,
    endPointReference: endType === 'up-to-vertex' ? { kind: 'sketch-point', sourceFeatureId: 'limitSketch', contourId: 'point', point: 'center', label: 'Stop point' } : undefined });
  doc.features.unshift(
    { id: 'limitSketch', name: 'Limit sketch', type: 'profile', plane: 'XY', offsetMillimeters: 8, suppressed: false,
      profile: { type: 'drawing', contours: [{ id: 'point', type: 'circle', center: [0, 0], radius: 50 }] } },
    { id: 'limit', name: 'Limit', type: 'extrude', profileFeatureId: 'limitSketch', distanceMillimeters: 5, bodyId: 'limitBody', operation: 'new', suppressed: false },
  );
  expect(volume(doc)).toBeCloseTo(integral(7.2, draftAngleDegrees) - integral(1.6, draftAngleDegrees), 5);
  }
});

it('retains native draft after moving the sketch onto a different principal plane', () => {
  const doc = fixture({ directionVector: [.8, .6, 0] });
  doc.features[0] = { ...doc.features[0], plane: 'YZ' } as PartFeature;
  expect(volume(doc)).toBeCloseTo(integral(8, 3), 5);
});

it('drafts an open thin line and its end caps with independent analytic volume', () => {
  const doc = fixture({ profileContourId: 'outline', thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 } });
  doc.features[0] = { ...doc.features[0], profile: { type: 'drawing', contours: [{ id: 'outline', type: 'path', start: [-10, 0], segments: [{ type: 'line', end: [10, 0] }] }] } } as PartFeature;
  expect(volume(doc)).toBeCloseTo(integral(8, 3, 20, 3), 5);
});

it('preserves a concave profile through rebuild, reopen and reversed travel', () => {
  const doc = fixture();
  doc.features[0] = { ...doc.features[0], profile: { type: 'polygon', pointsMillimeters: [[0, 0], [20, 0], [20, 5], [10, 5], [10, 15], [0, 15]] } } as PartFeature;
  const expected = volume(doc);
  expect(expected).toBeGreaterThan(0);
  expect(expected).toBeLessThan(200 * 8);
  expect(volume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(expected, 5);
  (doc.features[1] as ExtrudeFeature).reversed = true;
  expect(volume(doc)).toBeCloseTo(expected, 5);
});

it('rejects a collapsed or unavailable curved draft without substituting geometry or changing history', () => {
  const collapsed = fixture({ draftAngleDegrees: 40, distanceMillimeters: 100 });
  const before = serializePartDocument(collapsed);
  expect(() => volume(collapsed)).toThrow(/draft|collaps|solid/i);
  expect(serializePartDocument(collapsed)).toBe(before);
  const curved = fixture();
  curved.features[0] = { ...curved.features[0], profile: { type: 'circle', radiusMillimeters: 10, centerMillimeters: [0, 0] } } as PartFeature;
  expect(() => volume(curved)).toThrow(/straight profile edges/);
});
