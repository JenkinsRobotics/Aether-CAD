import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { measureArea, setOC } from 'replicad';
import { availableBodies, createEmptyPartDocument, insertFeature, parsePartDocument, serializePartDocument, type PartDocument, type ProfileFeature, type SurfaceExtrudeFeature } from '../document';
import { evaluatePartDocument } from './part-evaluator';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const line = (id: string, x: number, y = 0) => ({ id, type: 'path' as const, start: [x, y] as [number, number], segments: [{ type: 'line' as const, end: [x + 5, y] as [number, number] }] });
const sketch = (id: string, x: number): ProfileFeature => ({ id, name: id, type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
  profile: { type: 'drawing', contours: [line('a', x), line('b', x + 10), { ...line('construction', x + 20), construction: true }] } });
const feature = (extra: Partial<SurfaceExtrudeFeature> = {}): SurfaceExtrudeFeature => ({ id: 'surface', name: 'Surface extrusion', type: 'surface-extrude', suppressed: false,
  operation: 'new', profileFeatureId: 'sketch', distanceMillimeters: 4, separateBodies: true, ...extra });
const document = (extra: Partial<SurfaceExtrudeFeature> = {}): PartDocument => insertFeature({ ...createEmptyPartDocument('Surface outputs'), documentId: 'sheets', features: [sketch('sketch', 0)] }, feature(extra));
function build(doc: PartDocument) {
  const properties: Record<string, { area: number; min: number[]; max: number[] }> = {};
  const result = evaluatePartDocument(parsePartDocument(serializePartDocument(doc)), { withBodies: bodies => bodies.forEach((body, id) => {
    const [min, max] = body.boundingBox.bounds;
    properties[id] = { area: measureArea(body), min: [...min], max: [...max] };
  }) });
  return { result, properties };
}

it('publishes disconnected native sheets independently and excludes construction geometry', () => {
  const { result, properties } = build(document());
  expect(result.bodyOutputs?.surface).toHaveLength(2);
  expect(Object.keys(properties)).toEqual(result.bodyOutputs!.surface);
  Object.values(properties).forEach(value => expect(value.area).toBeCloseTo(20, 5));
});

it('whole-sketch agent references build the same sheets as explicit curve picks', () => {
  const whole = build(document({ profileSelections: [{ profileFeatureId: 'sketch' }] }));
  const explicit = build(document({ profileSelections: ['a', 'b'].map(profileContourId => ({ profileFeatureId: 'sketch', profileContourId })) }));
  expect(whole.properties).toEqual(explicit.properties);
});

it('keeps connected curves together while publishing a detached curve separately', () => {
  const doc = document(); const s = doc.features[0] as ProfileFeature;
  s.profile = { type: 'drawing', contours: [line('a', 0), line('b', 5), line('c', 20)] };
  const { properties } = build(doc);
  expect(Object.values(properties).map(p => p.area).sort((a, b) => a - b)).toEqual([expect.closeTo(20, 5), expect.closeTo(40, 5)]);
});

it('retains IDs through source reorder, dimension edit, curve removal and saved reopen', () => {
  const doc = document(), initial = build(doc);
  const s = doc.features[0] as ProfileFeature;
  if (s.profile.type !== 'drawing') throw Error('fixture');
  s.profile.contours.reverse();
  const f = doc.features[1] as SurfaceExtrudeFeature;
  f.bodyOutputs = initial.result.bodyOutputs!.surface;
  expect(build(doc).properties).toEqual(initial.properties);
  f.distanceMillimeters = 8;
  expect(Object.keys(build(doc).properties).sort()).toEqual(Object.keys(initial.properties).sort());
  f.profileSelections = [{ profileFeatureId: 'sketch', profileContourId: 'b' }];
  const remaining = build(doc), id = Object.keys(remaining.properties)[0];
  expect(initial.properties[id].min[0]).toBeCloseTo(10, 5);
  expect(remaining.properties[id].area).toBeCloseTo(40, 5);
  f.bodyOutputs = remaining.result.bodyOutputs!.surface;
  expect(availableBodies(doc).map(body => body.id)).toEqual([id]);
  expect(build(parsePartDocument(serializePartDocument(doc))).properties).toEqual(remaining.properties);
});

it('scopes duplicate curve names to their source sketches after primary-source removal', () => {
  const doc = document({ profileSelections: ['sketch', 'other'].map(profileFeatureId => ({ profileFeatureId, profileContourId: 'a' })) });
  doc.features.splice(1, 0, sketch('other', 30));
  const initial = build(doc), f = doc.features.at(-1) as SurfaceExtrudeFeature;
  f.profileFeatureId = 'other'; f.profileSelections!.reverse();
  expect(build(doc).properties).toEqual(initial.properties);
  f.profileSelections = [f.profileSelections![0]];
  const remaining = build(doc), id = Object.keys(remaining.properties)[0];
  expect(remaining.properties[id]).toEqual(initial.properties[id]);
  expect(remaining.properties[id].min[0]).toBeCloseTo(30, 5);
});

it('preserves the original compound body identity of an old file', () => {
  const doc = document({ separateBodies: undefined });
  const result = build(doc);
  expect(result.result.bodyOutputs?.surface).toBeUndefined();
  expect(Object.keys(result.properties)).toEqual(['sheets:body-1']);
  expect(result.properties['sheets:body-1'].area).toBeCloseTo(40, 5);
});

it('applies a downstream thicken only to the chosen sheet after saved reopen', () => {
  let doc = document(); const initial = build(doc);
  const f = doc.features[1] as SurfaceExtrudeFeature;
  f.bodyOutputs = initial.result.bodyOutputs!.surface;
  const id = f.bodyOutputs[0], other = f.bodyOutputs[1];
  doc = insertFeature(doc, { id: 'thicken', type: 'surface-thicken', name: 'Thicken one sheet', suppressed: false, bodyIds: [id], thicknessMillimeters: 1, keepTools: false, operation: 'new' });
  const after = build(doc);
  expect(after.properties[other]).toEqual(initial.properties[other]);
  expect(after.properties[id]).toBeUndefined();
  expect(Object.keys(after.properties)).toHaveLength(2);
});


it('does not sew away an intentional submillimeter gap between sheets', () => {
  const doc = document(), s = doc.features[0] as ProfileFeature;
  s.profile = { type: 'drawing', contours: [line('a', 0), line('b', 5.0005)] };
  const { properties } = build(doc);
  expect(Object.values(properties)).toHaveLength(2);
  Object.values(properties).forEach(p => expect(p.area).toBeCloseTo(20, 6));
});


it('assigns missing source identities atomically before an agent or human creates independent sheets', () => {
  const source = { ...createEmptyPartDocument('Unidentified curves'), documentId: 'new', features: [sketch('sketch', 0)] };
  const s = source.features[0];
  if (s.profile.type !== 'drawing') throw Error('fixture');
  s.profile.contours.forEach(curve => delete curve.id);
  const before = JSON.stringify(source), doc = insertFeature(source, feature());
  expect(JSON.stringify(source)).toBe(before);
  const identified = doc.features[0] as ProfileFeature;
  if (identified.profile.type !== 'drawing') throw Error('fixture');
  expect(identified.profile.contours.every(curve => Boolean(curve.id))).toBe(true);
  const original = build(doc);
  expect(original.result.bodyOutputs?.surface).toHaveLength(2);
  const reopened = parsePartDocument(serializePartDocument(doc));
  expect(build(reopened).properties).toEqual(original.properties);
});


it('refuses a whole-sketch pick combined with another pick from the same source', () => {
  expect(() => document({ profileSelections: [{ profileFeatureId: 'sketch' }, { profileFeatureId: 'sketch', profileContourId: 'missing' }] }))
    .toThrow(/either a whole sketch or distinct sketch curves/);
});
