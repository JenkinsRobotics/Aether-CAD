import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { measureArea, setOC } from 'replicad';
import { createEmptyPartDocument, bodyIDForFeature, availableBodies, insertFeature, parsePartDocument, serializePartDocument, type PartFeature, type SurfaceExtrudeFeature } from '../document';
import { evaluatePartDocument } from './part-evaluator';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const sketch = (id: string, z = 0): PartFeature => ({ id, type: 'profile', name: id, plane: 'XY', offsetMillimeters: z, suppressed: false,
  profile: { type: 'drawing', contours: [{ id: 'line', type: 'path', start: [-5, 0], segments: [{ type: 'line', end: [5, 0] }] }] } });
const extrude = (id: string, source: string, extra: Partial<SurfaceExtrudeFeature> = {}): SurfaceExtrudeFeature => ({ id, type: 'surface-extrude', name: id, suppressed: false,
  operation: 'new', profileFeatureId: source, distanceMillimeters: 4, ...extra });
function area(doc: ReturnType<typeof createEmptyPartDocument>) {
  const values: Record<string, number> = {};
  evaluatePartDocument(doc, { withBodies: bodies => bodies.forEach((body, id) => values[id] = measureArea(body)) });
  return values;
}

it.each(['up-to-face', 'up-to-part', 'up-to-next'] as const)('saves and rebuilds surface %s with shared stop and start handles', endType => {
  const doc = createEmptyPartDocument('Surface limits');
  const stop: PartFeature = { id: 'stop', type: 'extrude', name: 'Stop', profileFeatureId: 'base', distanceMillimeters: 5, operation: 'new', suppressed: false };
  doc.features = [{ id: 'base', type: 'profile', name: 'Base', plane: 'XY', offsetMillimeters: 10, suppressed: false, profile: { type: 'polygon', pointsMillimeters: [[-10, -10], [10, -10], [10, 10], [-10, 10]] } }, stop, sketch('s')];
  const id = bodyIDForFeature(doc, stop);
  const feature = extrude('surface', 's', { endType, startingOffsetMillimeters: 1, endOffsetMillimeters: 2,
    ...(endType === 'up-to-face' ? { endReference: { sourceFeatureId: 'stop', bodyId: id, normal: [0, 0, -1], label: 'Stop' } } : {}),
    ...(endType === 'up-to-part' ? { endPartId: id } : {}) });
  doc.features.push(feature);
  const output = bodyIDForFeature(doc, feature);
  expect(area(doc)[output]).toBeCloseTo(70, 5);
  expect(area(parsePartDocument(serializePartDocument(doc)))[output]).toBeCloseTo(70, 5);
  const model = evaluatePartDocument(doc, { preview: true });
  expect(model.previewHandles?.find(handle => handle.parameter === 'endOffset')?.originMillimeters[2]).toBeCloseTo(10, 5);
  expect(model.previewHandles?.find(handle => handle.parameter === 'offset')?.originMillimeters[2]).toBeCloseTo(0, 5);
});

it('keeps real curve identities and shared oblique, independent-end preview axes after reopen', () => {
  const doc = createEmptyPartDocument('Surface direction');
  const feature = extrude('e', 's', { directionVector: [0, 0.6, 0.8], startingOffsetMillimeters: 2, secondEnd: { endType: 'blind', distanceMillimeters: 3 },
    profileSelections: [{ profileFeatureId: 's', profileContourId: 'line' }] });
  doc.features = [sketch('s'), feature];
  expect(area(doc)[bodyIDForFeature(doc, feature)]).toBeCloseTo(70, 5);
  const reopened = parsePartDocument(serializePartDocument(doc));
  expect(reopened.features[1]).toEqual(feature);
  const model = evaluatePartDocument(reopened, { preview: true });
  expect(model.featurePreview?.extrusionAxes).toEqual(expect.arrayContaining([
    expect.objectContaining({ parameter: 'distance', direction: [0, 0.6, 0.8], originMillimeters: [0, 1.2, 1.6] }),
    expect.objectContaining({ parameter: 'second', direction: [-0, -0.6, -0.8] }),
  ]));
});

it('joins adjoining surfaces with explicit and automatic scope, retaining the first body identity', () => {
  for (const automatic of [false, true]) {
    const doc = createEmptyPartDocument('Surface Add');
    const first = extrude('first', 'a'), second = extrude('second', 'b', { distanceMillimeters: 3 });
    doc.features = [sketch('a'), first, sketch('b', 4), second];
    const id = bodyIDForFeature(doc, first);
    doc.features[3] = { ...second, operation: 'add', ...(automatic ? { scopeMode: 'all' } : { targetBodyId: id }) };
    expect(area(doc)).toEqual({ [id]: expect.closeTo(70, 5) });
    expect(area(parsePartDocument(serializePartDocument(doc)))).toEqual({ [id]: expect.closeTo(70, 5) });
    const model = evaluatePartDocument(doc);
    if (automatic) expect(model.scopeResolutions?.second).toEqual({ targets: [id], groups: [{ bodyId: id, sources: [id] }] });
  }
});

it('refuses disconnected explicit merge scope without changing saved history', () => {
  const doc = createEmptyPartDocument('Surface Add refusal'), first = extrude('first', 'a');
  doc.features = [sketch('a'), first, sketch('b', 10)];
  doc.features.push(extrude('second', 'b', { operation: 'add', targetBodyId: bodyIDForFeature(doc, first) }));
  const saved = serializePartDocument(doc);
  expect(() => area(doc)).toThrow(/share an edge/);
  expect(serializePartDocument(doc)).toBe(saved);
});

it('never drops a missing selected curve while rebuilding the remaining curves', () => {
  for (const selected of [
    { contourIds: ['line', 'missing'] },
    { profileSelections: [{ profileFeatureId: 's', profileContourId: 'line' }, { profileFeatureId: 's', profileContourId: 'missing' }] },
  ]) {
    const doc = createEmptyPartDocument('Missing surface curve');
    doc.features = [sketch('s'), extrude('surface', 's', selected)];
    const saved = serializePartDocument(doc);
    expect(() => area(doc)).toThrow(/selected sketch curve is unavailable/);
    expect(serializePartDocument(doc)).toBe(saved);
  }
});

it('retains a surface body identity when an earlier body is inserted', () => {
  let doc = createEmptyPartDocument('Stable surface');
  doc = insertFeature(doc, sketch('s'));
  doc = insertFeature(doc, extrude('surface', 's'));
  const originalId = bodyIDForFeature(doc, doc.features[1]);
  // Canonical insertion pins pre-existing outputs before changing history order.
  doc = insertFeature({ ...doc, rollbackIndex: 0 }, sketch('before', -10));
  doc = insertFeature(doc, extrude('first-body', 'before'));
  delete doc.rollbackIndex;
  expect(bodyIDForFeature(doc, doc.features.at(-1)!)).toBe(originalId);
  expect(area(doc)[originalId]).toBeCloseTo(40, 5);
  const reopened = parsePartDocument(serializePartDocument(doc));
  expect(area(reopened)).toEqual(area(doc));
});

it('merges a bridge into every selected sheet and preserves the primary target identity', () => {
  const doc = createEmptyPartDocument('Surface bridge');
  const first = extrude('first', 'a'), second = extrude('second', 'b');
  doc.features = [sketch('a'), first, sketch('b', 8), second, sketch('bridge', 4)];
  const one = bodyIDForFeature(doc, first), two = bodyIDForFeature(doc, second);
  doc.features.push(extrude('join', 'bridge', { operation: 'add', targetBodyId: two, targetBodyIds: [two, one] }));
  expect(area(doc)).toEqual({ [two]: expect.closeTo(120, 5) });
  expect(availableBodies(doc).map(body => body.id)).toEqual([two]);
  expect(area(parsePartDocument(serializePartDocument(doc)))).toEqual({ [two]: expect.closeTo(120, 5) });
});
