import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, measureVolume, measureArea } from 'replicad';
import { evaluatePartDocument } from './part-evaluator';
import { vertexAnchorsOf } from './part-geometry';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, featureDependencies, type PartFeature } from '../document/index';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const profile = (id: string, points: number[][]): PartFeature => ({ id, name: id, type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
  profile: { type: 'drawing', contours: [{ id: 'outline', type: 'path', start: points[0] as [number, number], segments: [...points.slice(1), points[0]].map(end => ({ type: 'line', end: end as [number, number] })) }] } });
function fixture(mode = 'solid', source = 'axis') {
  const doc = createEmptyPartDocument('Referenced extrusion direction');
  doc.features.push(profile('guide-profile', [[30, 0], [35, 0], [31, 3]]),
    { id: 'guide', name: 'Guide', type: 'extrude', profileFeatureId: 'guide-profile', bodyId: 'guide-body', distanceMillimeters: 10, operation: 'new', suppressed: false, directionVector: [.6, 0, .8] },
    { id: 'axis', name: 'Axis', type: 'axis', suppressed: false, definition: { method: 'edge', axis: { kind: 'axis', partId: 'guide-body', candidateId: 'guide-axis', label: 'Guide axis', originMillimeters: [30, 0, 0], directionMillimeters: [.6, 0, .8] } } });
  let reference: unknown = { kind: 'axis', sourceFeatureId: 'axis', label: 'Axis' };
  if (source === 'edge') evaluatePartDocument(doc, { withBodies: bodies => {
    const anchors = [...vertexAnchorsOf(bodies.get('guide-body')!).values()];
    const at = (p: number[]) => anchors.find(a => Math.hypot(...a.positionMillimeters.map((v, i) => v - p[i])) < 1e-6)!;
    reference = { kind: 'solid-edge', sourceFeatureId: 'guide', bodyId: 'guide-body', label: 'Guide edge', anchor: { start: at([30, 0, 0]), end: at([36, 0, 8]) } };
  } });
  doc.features.push(profile('profile', [[0, 0], [20, 0], [20, 10], [0, 10]]),
    { id: 'e', name: 'Extrude', type: mode === 'surface' ? 'surface-extrude' : 'extrude', profileFeatureId: 'profile', profileContourId: 'outline', bodyId: 'body', distanceMillimeters: 10,
      operation: 'new', suppressed: false, directionReference: reference, ...(mode === 'thin' ? { thin: { thickness1Millimeters: 1, thickness2Millimeters: 0 } } : {}) } as PartFeature);
  return doc;
}
function measure(doc: ReturnType<typeof fixture>, surface = false) {
  let value = 0;
  const model = evaluatePartDocument(doc, { preview: true, withBodies: bodies => { const body = bodies.get('body')!; value = surface ? measureArea(body) : measureVolume(body); } });
  return { value, model };
}

it.each(['solid', 'thin', 'surface'])('uses a construction axis in %s, follows its edit and survives saved reopen', mode => {
  const doc = fixture(mode), expected = mode === 'solid' ? 1600 : mode === 'thin' ? 512 : 520;
  expect(measure(doc, mode === 'surface').value).toBeCloseTo(expected, 5);
  expect(measure(parsePartDocument(serializePartDocument(doc)), mode === 'surface').value).toBeCloseTo(expected, 5);
  expect(featureDependencies(doc).get('e')).toContain('axis');
  (doc.features[2] as any).definition.axis.directionMillimeters = [0, 0, 1];
  expect(measure(doc, mode === 'surface').value).toBeCloseTo(mode === 'solid' ? 2000 : mode === 'thin' ? 640 : 600, 5);
});

it.each(['solid', 'thin', 'surface'])('uses the native straight edge in %s, with the same handles as numeric directions', mode => {
  const doc = fixture(mode, 'edge');
  const actual = measure(doc, mode === 'surface');
  expect(actual.value).toBeCloseTo(mode === 'solid' ? 1600 : mode === 'thin' ? 512 : 520, 5);
  expect(featureDependencies(doc).get('e')).toContain('guide');
  expect(measure(parsePartDocument(serializePartDocument(doc)), mode === 'surface').value).toBeCloseTo(actual.value, 6);
  const direction = actual.model.featurePreview?.extrusionAxes?.find(a => a.side === 'primary')?.direction;
  expect(direction).toBeDefined();
  direction!.forEach((value, i) => expect(value).toBeCloseTo([.6, 0, .8][i], 10));
});

it.each(['missing', 'suppressed', 'future', 'wrong-kind'])('refuses a %s axis without using the sketch normal', failure => {
  const doc = fixture();
  if (failure === 'missing') doc.features.splice(2, 1);
  else if (failure === 'suppressed') doc.features[2].suppressed = true;
  else if (failure === 'future') doc.features.push(doc.features.splice(2, 1)[0]);
  else (doc.features.at(-1) as any).directionReference.sourceFeatureId = 'guide';
  expect(() => measure(doc)).toThrow(/axis|Axis|earlier|suppressed|unavailable/);
});

it('refuses endpoint pairs that are not a native straight edge', () => {
  const doc = fixture('solid', 'edge');
  evaluatePartDocument({ ...doc, features: doc.features.slice(0, 3) }, { withBodies: bodies => {
    const anchors = [...vertexAnchorsOf(bodies.get('guide-body')!).values()];
    (doc.features.at(-1) as any).directionReference.anchor.end = anchors.find(a => Math.hypot(...a.positionMillimeters.map((v, i) => v - [41, 0, 8][i])) < 1e-6)!;
  } });
  expect(() => measure(doc)).toThrow(/edge|Edge/);
});

it.each(['axis', 'edge'])('uses the %s direction for reversed depth, starting offset and the second end', source => {
  const doc = fixture('solid', source), feature = doc.features.at(-1) as any;
  Object.assign(feature, { reversed: true, startingOffsetMillimeters: 2,
    secondEnd: { endType: 'blind', distanceMillimeters: 5 } });
  const actual = measure(doc);
  expect(actual.value).toBeCloseTo(2400, 5); // area 200 × projected length (10 + 5) × 0.8
  const axes = actual.model.featurePreview!.extrusionAxes!;
  for (const [side, expected] of [['primary', [-.6, 0, -.8]], ['opposite', [.6, 0, .8]]] as const) {
    const actual = axes.find(a => a.side === side)?.direction;
    expect(actual).toBeDefined(); actual!.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  }
});

it.each(['missing', 'suppressed', 'tangent'])('refuses a %s native edge without a fallback vector', failure => {
  const doc = fixture('solid', 'edge');
  if (failure === 'missing') doc.features.splice(1, 1);
  else if (failure === 'suppressed') doc.features[1].suppressed = true;
  else evaluatePartDocument({ ...doc, features: doc.features.slice(0, 3) }, { withBodies: bodies => {
    const anchors = [...vertexAnchorsOf(bodies.get('guide-body')!).values()];
    (doc.features.at(-1) as any).directionReference.anchor.end = anchors.find(a => Math.hypot(...a.positionMillimeters.map((v, i) => v - [35, 0, 0][i])) < 1e-6)!;
  } });
  expect(() => measure(doc)).toThrow(/source|edge|direction|plane|unavailable/i);
});

it('refuses a direction sketch line that has become an arc', () => {
  const doc = fixture(), guide = doc.features[0] as any;
  guide.plane = 'XZ';
  guide.profile.contours[0].segments[0] = { id: 'line', type: 'arc', middle: [32.5, 1], end: [35, 0] };
  doc.features.splice(1, 2);
  (doc.features.at(-1) as any).directionReference = { kind: 'sketch-line', sourceFeatureId: 'guide-profile', contourId: 'outline', segmentId: 'line' };
  expect(() => measure(doc)).toThrow(/straight|line|unavailable/i);
});
