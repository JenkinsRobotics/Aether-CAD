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
