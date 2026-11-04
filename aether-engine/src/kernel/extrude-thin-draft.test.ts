import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, measureVolume } from 'replicad';
import { evaluatePartDocument } from './part-evaluator';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, type ExtrudeFeature, type PartFeature } from '../document/index';

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) }));
}, 30000);

function fixture(kind: 'circle' | 'rectangle' | 'line', changes: Partial<ExtrudeFeature> = {}) {
  const doc = createEmptyPartDocument('Editable drafted thin wall');
  const contour = kind === 'circle'
    ? { id: 'wall', type: 'circle', center: [0, 0], radius: 10 }
    : { id: 'wall', type: 'path', start: [0, 0], segments: (kind === 'line' ? [[20, 0]] : [[20, 0], [20, 10], [0, 10], [0, 0]]).map(end => ({ type: 'line', end })) };
  doc.features.push(
    { id: 's', name: 'Sketch', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: { type: 'drawing', contours: [contour] } } as PartFeature,
    { id: 'e', name: 'Extrude', type: 'extrude', profileFeatureId: 's', profileContourId: 'wall', operation: 'new', suppressed: false,
      distanceMillimeters: 10, draftAngleDegrees: 3, thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 }, ...changes },
  );
  return doc;
}

function volume(doc: ReturnType<typeof fixture>) {
  let total = 0, count = 0;
  evaluatePartDocument(doc, { withBodies: bodies => { count = bodies.size; for (const body of bodies.values()) total += measureVolume(body); } });
  expect(count).toBe(1);
  return total;
}

const k = Math.tan(3 * Math.PI / 180);
it.each(['rectangle', 'circle', 'line'] as const)('drafts a thin %s with analytic volume and editable saved reopen', kind => {
  const doc = fixture(kind);
  // Integrate the area of the taper's actual planar sections, independently of OCCT.
  const expected = kind === 'circle' ? Math.PI * 21 * (30 - k * 100)
    : kind === 'rectangle' ? 1920 - 64 * k * 100
    : 600 - 23 * k * 100 + 4 / 3 * k * k * 1000;
  expect(volume(doc)).toBeCloseTo(expected, 4);
  const reopened = parsePartDocument(serializePartDocument(doc));
  expect(reopened).toEqual(doc);
  expect(volume(reopened)).toBeCloseTo(expected, 4);
});

it('keeps the sketch neutral through a starting offset and independent opposite draft', () => {
  const doc = fixture('rectangle', { startingOffsetMillimeters: 2,
    secondEnd: { endType: 'blind', distanceMillimeters: 4, draftAngleDegrees: -3 } });
  // Primary spans t=2..12, opposite spans t=-2..2 with the widening slope -k.
  expect(volume(doc)).toBeCloseTo(192 * 14 - 64 * k * (144 - 4), 4);
});

it('supports symmetric draft and rejects collapsed thin walls without mutating history', () => {
  const symmetric = fixture('rectangle', { endType: 'symmetric' });
  expect(volume(symmetric)).toBeCloseTo(2 * (192 * 5 - 64 * k * 25), 4);
  const invalid = fixture('line', { draftAngleDegrees: 30 });
  const before = serializePartDocument(invalid);
  expect(() => volume(invalid)).toThrow(/collaps|intersect|offset|solid/i);
  expect(serializePartDocument(invalid)).toBe(before);
});

it('puts the shared draft rings on the neutral boundary and reverses widening correctly', () => {
  const preview = (changes: Partial<ExtrudeFeature>) => evaluatePartDocument(fixture('rectangle', changes), { preview: true }).previewHandles!;
  const ring = preview({}).find(h => h.parameter === 'draftAngle')!;
  expect(ring).toMatchObject({ kind: 'angular', label: 'Draft angle', stepDegrees: 1 });
  expect(ring.originMillimeters[2]).toBeCloseTo(0);
  const radius = ring.startMillimeters!.map((v, i) => v - ring.originMillimeters[i]);
  expect(radius).toEqual([0, 0, 10]);
  // Positive angle moves this outer wall toward material, rather than away from it.
  const [x, y, z] = ring.direction;
  const derivative = [y * radius[2] - z * radius[1], z * radius[0] - x * radius[2], x * radius[1] - y * radius[0]];
  const towardCenter = [10, 5, 0].map((v, i) => v - ring.originMillimeters[i]);
  expect(derivative.reduce((sum, v, i) => sum + v * towardCenter[i], 0)).toBeGreaterThan(0);
  const widening = preview({ draftAngleDegrees: -3 }).find(h => h.parameter === 'draftAngle')!;
  widening.direction.forEach((v, i) => expect(v).toBeCloseTo(-ring.direction[i]));
  const symmetric = preview({ endType: 'symmetric' });
  expect(symmetric.find(h => h.parameter === 'oppositeDraftAngle')?.startMillimeters?.[2]).toBeCloseTo(-5);
  const independent = preview({ secondEnd: { endType: 'blind', distanceMillimeters: 4, draftAngleDegrees: 2 } });
  expect(independent.find(h => h.parameter === 'secondDraftAngle')?.startMillimeters?.[2]).toBeCloseTo(-4);
  for (const kind of ['circle', 'line'] as const) {
    const ring = evaluatePartDocument(fixture(kind), { preview: true }).previewHandles!.find(h => h.parameter === 'draftAngle')!;
    const [ax, ay] = ring.direction;
    const towardMaterial = (kind === 'circle' ? [0, 0, 0] : [10, -.5, 0]).map((v, i) => v - ring.originMillimeters[i]);
    expect(ay * towardMaterial[0] - ax * towardMaterial[1]).toBeGreaterThan(0);
  }
});

it('aligns thickness handles with the actual shifted draft wall, flip and mid-plane values', () => {
  const doc = fixture('rectangle', { startingOffsetMillimeters: 2 });
  const model = evaluatePartDocument(doc, { preview: true });
  const outer = model.previewHandles!.find(h => h.parameter === 'thickness1')!;
  expect(outer.nonnegative).toBe(true);
  outer.direction.forEach((v, i) => expect(v).toBeCloseTo([0, -1, 0][i]));
  const edge = outer.originMillimeters.map((v, i) => v + outer.direction[i] * 2);
  const ys = model.featurePreview!.added.flatMap(part => Array.from(part.vertices).filter((_, i) => i % 3 === 1));
  expect(edge[1]).toBeCloseTo(Math.min(...ys), 5);
  expect(edge[2]).toBeCloseTo(2);
  const flipped = evaluatePartDocument(fixture('line', { draftAngleDegrees: 0, thin: { thickness1Millimeters: 2, thickness2Millimeters: 0, flipped: true } }), { preview: true });
  const side = flipped.previewHandles!.find(h => h.parameter === 'thickness1')!;
  expect(side.originMillimeters).toEqual([10, 0, 0]);
  side.direction.forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0][i]));
  const middle = evaluatePartDocument(fixture('rectangle', { thin: { thickness1Millimeters: 0, thickness2Millimeters: 0, midplane: true, midplaneThicknessMillimeters: 3 } }), { preview: true });
  expect(middle.previewHandles!.find(h => h.parameter === 'midThickness')).toMatchObject({ scale: 2 });
  expect(middle.previewHandles!.some(h => h.parameter === 'thickness1' || h.parameter === 'thickness2')).toBe(false);
});
