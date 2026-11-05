import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, measureArea, measureVolume } from 'replicad';
import { evaluatePartDocument } from './part-evaluator';
import { deleteAfterVectorTuple } from '../geometry/index';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, featureDependencies } from '../document/index';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
function fixture(surfaceType = 'cylinder', mode = 'solid') {
  const doc = createEmptyPartDocument('Face axis');
  doc.features = [
    { id: 'guide-profile', type: 'profile', name: 'Guide sketch', suppressed: false, plane: 'XY', offsetMillimeters: 0,
      frame: { originMillimeters: [30, 0, 0], normal: [.6, 0, .8], xDirection: [.8, 0, -.6] },
      profile: { type: 'circle', radiusMillimeters: 5, centerMillimeters: [0, 0] } },
    { id: 'guide', type: 'extrude', name: 'Guide', suppressed: false, profileFeatureId: 'guide-profile', bodyId: 'guide-body',
      operation: 'new', distanceMillimeters: 10, ...(surfaceType === 'cone' ? { draftAngleDegrees: 5 } : {}) },
    { id: 's', type: 'profile', name: 'Sketch', suppressed: false, plane: 'XY', offsetMillimeters: 0,
      profile: { type: 'drawing', contours: [{ id: 'outline', type: 'path', start: [0, 0], segments: [
        { type: 'line', end: [20, 0] }, { type: 'line', end: [20, 10] }, { type: 'line', end: [0, 10] }, { type: 'line', end: [0, 0] }] }] } },
    { id: 'e', type: mode === 'surface' ? 'surface-extrude' : 'extrude', name: 'Extrude', suppressed: false,
      profileFeatureId: 's', profileContourId: 'outline', bodyId: 'body', operation: 'new', distanceMillimeters: 10,
      directionReference: { kind: 'face-axis', sourceFeatureId: 'guide', bodyId: 'guide-body', label: 'Guide axis', surfaceType },
      ...(mode === 'thin' ? { thin: { thickness1Millimeters: 1, thickness2Millimeters: 0 } } : {}) },
  ] as any;
  return doc;
}
function measure(doc: ReturnType<typeof fixture>, mode = 'solid') {
  let value = 0;
  const model = evaluatePartDocument(doc, { preview: true, withBodies: bodies => {
    value = mode === 'surface' ? measureArea(bodies.get('body')!) : measureVolume(bodies.get('body')!);
  } });
  return { value, axis: model.featurePreview?.extrusionAxes?.find(a => a.side === 'primary')?.direction };
}
it.each(['cylinder', 'cone'].flatMap(surface => ['solid', 'thin', 'surface'].map(mode => [surface, mode])))('follows %s face axes in %s and retains editable intent', (surface, mode) => {
  const doc = fixture(surface, mode), expected = mode === 'solid' ? 1600 : mode === 'thin' ? 512 : 520;
  expect(measure(doc, mode).value).toBeCloseTo(expected, 5);
  expect(featureDependencies(doc).get('e')).toContain('guide');
  const reopened = parsePartDocument(serializePartDocument(doc));
  expect(measure(reopened, mode).value).toBeCloseTo(expected, 5);
  const guide = reopened.features[0] as any;
  guide.frame.normal = [0, 0, 1]; guide.frame.xDirection = [1, 0, 0];
  guide.profile.radiusMillimeters = 6;
  expect(measure(reopened, mode).value).toBeCloseTo(mode === 'solid' ? 2000 : mode === 'thin' ? 640 : 600, 5);
  measure(reopened, mode).axis!.forEach((value, i) => expect(value).toBeCloseTo([0, 0, 1][i], 9));
});
it.each(['cylinder', 'cone'])('uses the %s axis for reversed, offset and second-end handles', surface => {
  const doc = fixture(surface), feature = doc.features.at(-1) as any;
  Object.assign(feature, { reversed: true, startingOffsetMillimeters: 2, secondEnd: { endType: 'blind', distanceMillimeters: 5 } });
  const result = measure(doc);
  expect(result.value).toBeCloseTo(2400, 5);
  result.axis!.forEach((value, i) => expect(value).toBeCloseTo([-.6, 0, -.8][i], 9));
});
it.each(['missing', 'suppressed', 'future', 'wrong-surface', 'tangent'])('refuses %s face references instead of substituting a direction', failure => {
  const doc = fixture();
  if (failure === 'missing') doc.features.splice(1, 1);
  if (failure === 'suppressed') doc.features[1].suppressed = true;
  if (failure === 'future') doc.features.push(doc.features.splice(1, 1)[0]);
  if (failure === 'wrong-surface') (doc.features.at(-1) as any).directionReference.surfaceType = 'sphere';
  if (failure === 'tangent') Object.assign((doc.features[0] as any).frame, { normal: [1, 0, 0], xDirection: [0, 1, 0] });
  expect(() => measure(doc)).toThrow(/axis|face|earlier|unavailable|tangent/i);
});
it('honors an exact face discriminator and refuses it after the source face changes', () => {
  const doc = fixture(), ref = (doc.features.at(-1) as any).directionReference;
  evaluatePartDocument({ ...doc, features: doc.features.slice(0, 2) }, { withBodies: bodies => {
    const faces = bodies.get('guide-body')!.faces;
    try {
      const face = faces.find(f => ['CYLINDRE', 'CYLINDER'].includes(f.geomType))!;
      ref.faceAnchor = { centerMillimeters: deleteAfterVectorTuple(face.center), areaSquareMillimeters: measureArea(face) };
    } finally { faces.forEach(f => f.delete()); }
  } });
  expect(measure(doc).value).toBeCloseTo(1600, 5);
  (doc.features[0] as any).profile.radiusMillimeters = 6;
  expect(() => measure(doc)).toThrow(/changed|ambiguous/);
});

it('refuses an unanchored axis when multiple cylindrical faces exist', () => {
  const doc = fixture();
  (doc.features[0] as any).profile = { type: 'drawing', contours: [
    { id: 'a', type: 'circle', center: [0, 0], radius: 5 },
    { id: 'b', type: 'circle', center: [20, 0], radius: 3 }] };
  expect(() => measure(doc)).toThrow(/ambiguous/);
});
