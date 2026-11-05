import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { measureVolume, setOC } from 'replicad';
import { evaluatePartDocument } from './part-evaluator';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, type ExtrudeFeature, type PartFeature } from '../document/index';

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) }));
}, 30000);

function fixture(changes: Partial<ExtrudeFeature> = {}, reverse = false) {
  const doc = createEmptyPartDocument('Native stopping controls');
  doc.features = [
    { id: 'limitSketch', type: 'profile', name: 'Limit sketch', plane: 'XY', offsetMillimeters: reverse ? -15 : 10, suppressed: false,
      profile: { type: 'polygon', pointsMillimeters: [[-50, -50], [50, -50], [50, 50], [-50, 50]] } },
    { id: 'limit', type: 'extrude', name: 'Limit', profileFeatureId: 'limitSketch', distanceMillimeters: 5, operation: 'new', bodyId: 'limitBody', suppressed: false },
    { id: 's', type: 'profile', name: 'Sketch', plane: 'XY', offsetMillimeters: 0, suppressed: false,
      profile: { type: 'drawing', contours: [{ id: 'wall', type: 'path', start: [0, 0], segments: [[20, 0], [20, 10], [0, 10], [0, 0]].map(end => ({ type: 'line', end })) }] } },
    { id: 'e', type: 'extrude', name: 'Extrude', profileFeatureId: 's', operation: 'new', bodyId: 'output', suppressed: false,
      distanceMillimeters: 1, endType: 'up-to-face', reversed: reverse,
      endReference: { sourceFeatureId: 'limit', bodyId: 'limitBody', normal: [0, 0, reverse ? 1 : -1], label: 'Stop' },
      ...changes },
  ] as PartFeature[];
  return doc;
}

const areaIntegral = (t: number, angle: number, thin: boolean) => {
  const k = Math.tan(angle * Math.PI / 180);
  return thin ? 192 * t - 64 * k * t * t : 200 * t - 30 * k * t * t + 4 / 3 * k * k * t * t * t;
};
function outputVolume(doc: ReturnType<typeof fixture>) {
  let value = 0;
  evaluatePartDocument(doc, { withBodies: bodies => { value = measureVolume(bodies.get('output')!); } });
  return value;
}

it.each([false, true])('terminates a %s thin drafted wall at a parallel native face with offset and saved reopen', thin => {
  for (const reversed of [false, true]) for (const angle of [3, -3]) {
    const doc = fixture({ startingOffsetMillimeters: 2, endOffsetMillimeters: 1,
      draftAngleDegrees: angle, ...(thin ? { profileContourId: 'wall', thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 } } : {}) }, reversed);
    const expected = areaIntegral(9, angle, thin) - areaIntegral(2, angle, thin);
    expect(outputVolume(doc)).toBeCloseTo(expected, 4);
    expect(outputVolume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(expected, 4);
    const handles = evaluatePartDocument(doc, { preview: true }).previewHandles!;
    const offset = handles.find(handle => handle.parameter === 'endOffset')!;
    expect(offset.signed).toBe(true);
    expect(offset.originMillimeters[2]).toBeCloseTo(reversed ? -10 : 10);
    expect(offset.direction[2]).toBeCloseTo(reversed ? 1 : -1);
    expect(offset.originMillimeters[2] + offset.direction[2]).toBeCloseTo(reversed ? -9 : 9);
  }
});

it('uses independent native offset controls for each end, and preserves their drafts', () => {
  const doc = fixture({ draftAngleDegrees: 3, endOffsetMillimeters: 1 });
  const below = fixture({}, true).features.slice(0, 2).map(feature => ({ ...feature, id: feature.id + 'Below',
    ...(feature.type === 'extrude' ? { profileFeatureId: 'limitSketchBelow', bodyId: 'belowBody' } : {}) })) as PartFeature[];
  doc.features.splice(2, 0, ...below);
  (doc.features.at(-1) as ExtrudeFeature).secondEnd = { endType: 'up-to-face', distanceMillimeters: 1, endOffsetMillimeters: 2, draftAngleDegrees: -3,
    endReference: { sourceFeatureId: 'limitBelow', bodyId: 'belowBody', normal: [0, 0, 1], label: 'Opposite stop' } };
  expect(outputVolume(doc)).toBeCloseTo(areaIntegral(9, 3, false) + areaIntegral(8, -3, false), 4);
  const handles = evaluatePartDocument(doc, { preview: true }).previewHandles!;
  expect(handles.find(handle => handle.parameter === 'endOffset')?.originMillimeters[2]).toBeCloseTo(10);
  const opposite = handles.find(handle => handle.parameter === 'secondOffset')!;
  expect(opposite.originMillimeters[2]).toBeCloseTo(-10);
  expect(opposite.direction[2]).toBeCloseTo(1);
});

it.each(['up-to-next', 'up-to-part'] as const)('anchors %s offset on actual terminal contact instead of the far face', endType => {
  for (const offset of [-2, 0, 2]) {
    const doc = fixture({ endType, endPartId: endType === 'up-to-part' ? 'limitBody' : undefined, endReference: undefined, endOffsetMillimeters: offset });
    const model = evaluatePartDocument(doc, { preview: true });
    expect(outputVolume(doc)).toBeCloseTo(200 * (10 - offset), 4);
    const handle = model.previewHandles!.find(handle => handle.parameter === 'endOffset')!;
    expect(handle.originMillimeters[0]).toBeCloseTo(10);
    expect(handle.originMillimeters[1]).toBeCloseTo(5);
    expect(handle.originMillimeters[2]).toBeCloseTo(10);
    expect(handle.direction[2]).toBeCloseTo(-1);
  }
});

it.each(['up-to-next', 'up-to-part'] as const)('drafts solid and thin extrusions to %s without changing the stopping distance', endType => {
  for (const thin of [false, true]) for (const reversed of [false, true]) for (const angle of [3, -3]) {
    const doc = fixture({ endType, endPartId: endType === 'up-to-part' ? 'limitBody' : undefined,
      endReference: undefined, startingOffsetMillimeters: 2, endOffsetMillimeters: 1,
      draftAngleDegrees: angle,
      ...(thin ? { profileContourId: 'wall', thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 } } : {}) }, reversed);
    const expected = areaIntegral(9, angle, thin) - areaIntegral(2, angle, thin);
    expect(outputVolume(doc)).toBeCloseTo(expected, 4);
    expect(outputVolume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(expected, 4);
  }
});

it('provides the same signed offset control at a native stopping sketch point', () => {
  const doc = fixture({ endType: 'up-to-vertex', endReference: undefined, endOffsetMillimeters: -2,
    endPointReference: { kind: 'sketch-point', sourceFeatureId: 'point', contourId: 'circle', point: 'center', label: 'Point' } });
  doc.features.splice(0, 0, { id: 'point', name: 'Stopping point', type: 'profile', plane: 'XY', offsetMillimeters: 10, suppressed: false,
    profile: { type: 'drawing', contours: [{ id: 'circle', type: 'circle', center: [30, 30], radius: 2 }] } });
  expect(outputVolume(doc)).toBeCloseTo(2400, 4);
  const handle = evaluatePartDocument(doc, { preview: true }).previewHandles!.find(handle => handle.parameter === 'endOffset')!;
  expect(handle.originMillimeters[2]).toBeCloseTo(10);
  expect(handle.direction[2]).toBeCloseTo(-1);
});

it('refuses an offset behind the start or a collapsed draft without changing the document', () => {
  for (const change of [{ endOffsetMillimeters: 11 }, { draftAngleDegrees: 80 }]) {
    const doc = fixture(change), saved = serializePartDocument(doc);
    expect(() => outputVolume(doc)).toThrow();
    expect(serializePartDocument(doc)).toBe(saved);
  }
});

it.each(['up-to-next', 'up-to-part'] as const)('refuses a widened draft escaping the finite %s boundary', endType => {
  const doc = fixture({ endType, endPartId: endType === 'up-to-part' ? 'limitBody' : undefined,
    endReference: undefined, draftAngleDegrees: -3 });
  doc.features[0] = { ...doc.features[0], profile: { type: 'polygon', pointsMillimeters: [[-.1, -.1], [20.1, -.1], [20.1, 10.1], [-.1, 10.1]] } } as PartFeature;
  const saved = serializePartDocument(doc);
  expect(() => outputVolume(doc)).toThrow(/fully|completely|terminate|stop/);
  expect(serializePartDocument(doc)).toBe(saved);
});

it.each(['up-to-next', 'up-to-part'] as const)('terminates a narrowing profile on a smaller %s footprint', endType => {
  const doc = fixture({ endType, endPartId: endType === 'up-to-part' ? 'limitBody' : undefined,
    endReference: undefined, draftAngleDegrees: 10 });
  doc.features[0] = { ...doc.features[0], profile: { type: 'polygon', pointsMillimeters: [[1, 1], [19, 1], [19, 9], [1, 9]] } } as PartFeature;
  expect(outputVolume(doc)).toBeCloseTo(areaIntegral(10, 10, false), 4);
  expect(outputVolume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(areaIntegral(10, 10, false), 4);
});

it.each(['up-to-next', 'up-to-part'] as const)('ignores a distant back face beyond the taper collapse for %s', endType => {
  const doc = fixture({ endType, endPartId: endType === 'up-to-part' ? 'limitBody' : undefined,
    endReference: undefined, draftAngleDegrees: 10 });
  (doc.features[1] as ExtrudeFeature).distanceMillimeters = 100;
  expect(outputVolume(doc)).toBeCloseTo(areaIntegral(10, 10, false), 4);
  expect(outputVolume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(areaIntegral(10, 10, false), 4);
  doc.features[0] = { ...doc.features[0], offsetMillimeters: 40 } as PartFeature;
  const saved = serializePartDocument(doc);
  expect(() => outputVolume(doc)).toThrow();
  expect(serializePartDocument(doc)).toBe(saved);
});

it('ignores the axial cylindrical wall of a stopping part when finding the next drafted cap', () => {
  const doc = fixture({ endType: 'up-to-next', endReference: undefined, draftAngleDegrees: 3 });
  doc.features[0] = { ...doc.features[0], profile: { type: 'circle', centerMillimeters: [10, 5], radiusMillimeters: 20 } } as PartFeature;
  expect(outputVolume(doc)).toBeCloseTo(areaIntegral(10, 3, false), 4);
  expect(outputVolume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(areaIntegral(10, 3, false), 4);
});

it.each(['up-to-face', 'up-to-next', 'up-to-part'] as const)('keeps a tilted %s surface fixed while drafting its side walls', endType => {
  const slope = .2, c = 1 / Math.hypot(1, slope), height = 9;
  for (const angle of [-3, 3]) {
    const doc = fixture({ endType, endPartId: endType === 'up-to-part' ? 'limitBody' : undefined,
      endReference: endType === 'up-to-face' ? { sourceFeatureId: 'limit', bodyId: 'limitBody', normal: [slope * c, 0, -c], label: 'Tilted stop' } : undefined,
      startingOffsetMillimeters: 2, endOffsetMillimeters: 1, draftAngleDegrees: angle });
    doc.features[0] = { ...doc.features[0], frame: { originMillimeters: [0, 0, 10], normal: [-slope * c, 0, c], xDirection: [c, 0, slope * c] } } as PartFeature;
    // Integrate horizontal cross-sections: first the whole tapered rectangle,
    // then only its portion below z = height + slope*x.
    const k = Math.tan(angle * Math.PI / 180), first = height / (1 - slope * k), last = (height + 20 * slope) / (1 + slope * k);
    const a = 20 + height / slope, b = k + 1 / slope;
    const partial = (t: number) => 10 * a * t - (2 * a * k + 10 * b) * t * t / 2 + 2 * b * k * t * t * t / 3;
    const expected = areaIntegral(first, angle, false) - areaIntegral(2, angle, false) + partial(last) - partial(first);
    expect(outputVolume(doc)).toBeCloseTo(expected, 4);
    expect(outputVolume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(expected, 4);
  }
});

it.each(['up-to-face', 'up-to-next', 'up-to-part'] as const)('drafts a circular profile inside a spherical %s limit with an analytic volume', endType => {
  for (const angle of [-3, 3]) {
    const doc = fixture({ endType, endPartId: endType === 'up-to-part' ? 'limitBody' : undefined,
      endReference: endType === 'up-to-face' ? { sourceFeatureId: 'limit', bodyId: 'limitBody', surfaceType: 'sphere', label: 'Sphere' } : undefined,
      draftAngleDegrees: angle });
    doc.features[0] = { id: 'limitSketch', name: 'Sphere meridian', type: 'profile', plane: 'XZ', offsetMillimeters: 0, suppressed: false,
      profile: { type: 'drawing', contours: [{ id: 'meridian', type: 'path', start: [0, -10], segments: [{ type: 'arc', middle: [10, 0], end: [0, 10] }, { type: 'line', end: [0, -10] }] }] } };
    doc.features[1] = { id: 'limit', name: 'Spherical limit', type: 'revolve', profileFeatureId: 'limitSketch', axis: 'Z', angleDegrees: 360, suppressed: false, operation: 'new', bodyId: 'limitBody' };
    doc.features[2] = { id: 's', name: 'Round profile', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: { type: 'circle', centerMillimeters: [0, 0], radiusMillimeters: 4 } };
    const k = Math.tan(angle * Math.PI / 180), top = (4 * k + Math.sqrt((1 + k * k) * 100 - 16)) / (1 + k * k);
    const cylinder = (t: number) => 16 * t - 4 * k * t * t + k * k * t * t * t / 3;
    const sphere = (t: number) => 100 * t - t * t * t / 3;
    const expected = Math.PI * (cylinder(top) + sphere(10) - sphere(top));
    expect(outputVolume(doc)).toBeCloseTo(expected, 3);
    expect(outputVolume(parsePartDocument(serializePartDocument(doc)))).toBeCloseTo(expected, 3);
  }
});
