import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { measureArea, measureVolume, setOC } from 'replicad';
import { createEmptyPartDocument, availableBodies, consumedBodyIDs, featureDependencies, setFeatureSuppressed, parsePartDocument, serializePartDocument, type PartFeature, type SurfaceExtrudeFeature } from '../document';
import { evaluatePartDocument } from './part-evaluator';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const sketch = (id: string, xs: number[], z = 0): PartFeature => ({ id, type: 'profile', name: id, plane: 'XY', offsetMillimeters: z, suppressed: false,
  profile: { type: 'drawing', contours: xs.map((x, i) => ({ id: `line-${i}`, type: 'path', start: [x, 0], segments: [{ type: 'line', end: [x + 10, 0] }] })) } });
const extrusion = (id: string, source: string, extra: Partial<SurfaceExtrudeFeature> = {}): SurfaceExtrudeFeature => ({ id, type: 'surface-extrude', name: id, suppressed: false,
  operation: 'new', bodyId: id, profileFeatureId: source, distanceMillimeters: 4, ...extra });
function fixture(automatic = false) {
  const doc = createEmptyPartDocument('Independent Surface Add');
  doc.features = [sketch('s1', [0]), extrusion('a', 's1'), sketch('s2', [20]), extrusion('b', 's2'), sketch('add', [0, 20], 4),
    extrusion('join', 'add', { operation: 'add', connectedMerge: true, ...(automatic ? { scopeMode: 'all' } : { targetBodyId: 'b', targetBodyIds: ['b', 'a'] }) })];
  return doc;
}
function evaluate(doc: ReturnType<typeof fixture>) {
  const areas: Record<string, number> = {};
  const model = evaluatePartDocument(doc, { withBodies: bodies => bodies.forEach((body, id) => areas[id] = measureArea(body)) });
  return { areas, scope: model.scopeResolutions?.join };
}
it.each([false, true])('keeps disconnected additions on their own bodies, automatic=%s', automatic => {
  const doc = fixture(automatic), result = evaluate(doc);
  expect(result.areas).toEqual({ a: expect.closeTo(80, 6), b: expect.closeTo(80, 6) });
  expect(result.scope?.groups).toEqual(expect.arrayContaining([{ bodyId: 'a', sources: ['a'] }, { bodyId: 'b', sources: ['b'] }]));
  const join = doc.features.at(-1) as SurfaceExtrudeFeature;
  join.scopeResolution = result.scope;
  expect(consumedBodyIDs(join)).toEqual([]);
  expect(availableBodies(doc).map(body => body.id)).toEqual(['a', 'b']);
  expect(evaluate(parsePartDocument(serializePartDocument(doc)))).toEqual(result);
  doc.features.push({ id: 'thicken', type: 'surface-thicken', name: 'Thicken B', suppressed: false, operation: 'new', bodyIds: ['b'], thicknessMillimeters: 1 });
  expect(featureDependencies(doc).get('thicken')).toContain('join');
  let volume = 0;
  evaluatePartDocument(doc, { withBodies: bodies => { volume = measureVolume(bodies.get(`${doc.documentId}:body-thicken`)!); } });
  expect(volume).toBeCloseTo(80, 5);
  expect(setFeatureSuppressed(doc, 'join', true).features.at(-1)?.suppressed).toBe(true);
});
it.each([false, true])('merges a bridge and preserves the primary identity, automatic=%s', automatic => {
  const doc = fixture(automatic);
  doc.features[2] = sketch('s2', [0], 8);
  doc.features[4] = sketch('add', [0], 4);
  const result = evaluate(doc), primary = automatic ? 'a' : 'b';
  expect(result.areas).toEqual({ [primary]: expect.closeTo(120, 6) });
  expect(result.scope?.groups).toEqual([{ bodyId: primary, sources: automatic ? ['a', 'b'] : ['b', 'a'] }]);
  Object.assign(doc.features.at(-1)!, { scopeResolution: result.scope });
  expect(availableBodies(doc).map(body => body.id)).toEqual([primary]);
  expect(evaluate(parsePartDocument(serializePartDocument(doc)))).toEqual(result);
  expect(availableBodies(setFeatureSuppressed(doc, 'join', true)).map(body => body.id)).toEqual(['a', 'b']);
});
it.each([false, true])('refuses a detached tool component even when another joins, automatic=%s', automatic => {
  const doc = fixture(automatic); doc.features[4] = sketch('add', [0, 20, 50], 4);
  const original = serializePartDocument(doc);
  expect(() => evaluate(doc)).toThrow(/Every added surface must share an edge/);
  expect(serializePartDocument(doc)).toBe(original);
});
it('rejects an unrelated explicit target but leaves it untouched in automatic mode', () => {
  const doc = fixture(); doc.features[4] = sketch('add', [0], 4);
  expect(() => evaluate(doc)).toThrow(/every surface/);
  Object.assign(doc.features.at(-1)!, { scopeMode: 'all', targetBodyId: undefined, targetBodyIds: undefined });
  expect(evaluate(doc).areas).toEqual({ a: expect.closeTo(80, 6), b: expect.closeTo(40, 6) });
});
it('retains a legacy Add single-compound result and its saved identity', () => {
  const doc = fixture(); delete (doc.features.at(-1) as SurfaceExtrudeFeature).connectedMerge;
  expect(evaluate(doc).areas).toEqual({ b: expect.closeTo(160, 6) });
  expect(availableBodies(doc).map(body => body.id)).toEqual(['b']);
});
it('preserves an earlier compound body identity when both disconnected sheets grow', () => {
  const doc = fixture(); doc.features = [sketch('s1', [0, 20]), extrusion('a', 's1'), sketch('add', [0, 20], 4),
    extrusion('join', 'add', { operation: 'add', connectedMerge: true, targetBodyId: 'a' })];
  expect(evaluate(doc).areas).toEqual({ a: expect.closeTo(160, 6) });
});
it('does not close an intentional small boundary gap', () => {
  const doc = fixture(true); doc.features[4] = sketch('add', [0, 20], 4.0005);
  expect(() => evaluate(doc)).toThrow(/Every added surface must share an edge/);
});
