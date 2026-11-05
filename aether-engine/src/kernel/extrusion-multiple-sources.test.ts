import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { measureArea, measureVolume, setOC } from 'replicad';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, insertFeature, bodyIDForFeature, type PartFeature, type ExtrudeFeature, type ProfileFeature, type PartDocument } from '../document';
import { evaluatePartDocument } from './part-evaluator';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const circle = (id: string, x: number, z = 0): ProfileFeature => ({ id, type: 'profile', name: id, plane: 'XY', offsetMillimeters: z, suppressed: false,
  profile: { type: 'drawing', contours: [{ id: 'same-name', type: 'circle', center: [x, 0], radius: 2 }] } });
const line = (id: string, y: number, z = 0): ProfileFeature => ({ id, type: 'profile', name: id, plane: 'XY', offsetMillimeters: z, suppressed: false,
  profile: { type: 'drawing', contours: [{ id: 'same-name', type: 'path', start: [-5, y], segments: [{ type: 'line', end: [5, y] }] }] } });
const feature = (extra: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({ id: 'e', type: 'extrude', name: 'Extrude', suppressed: false,
  profileFeatureId: 'a', profileSelections: ['a', 'b'].map(profileFeatureId => ({ profileFeatureId, profileContourId: 'same-name' })),
  operation: 'new', distanceMillimeters: 5, ...extra });
function model(features: PartFeature[]) {
  const doc = { ...createEmptyPartDocument('Multiple sources'), documentId: 'multi', features };
  const properties: Record<string, { volume: number; area: number; min: number[]; max: number[] }> = {};
  const result = evaluatePartDocument(parsePartDocument(serializePartDocument(doc)), { withBodies: bodies => bodies.forEach((body, id) => {
    const [min, max] = body.boundingBox.bounds;
    properties[id] = { volume: measureVolume(body), area: measureArea(body), min: [...min], max: [...max] };
  }) });
  return { doc, result, properties, values: Object.values(properties) };
}

it('builds real disjoint solids from different sketches, including duplicate contour names', () => {
  const result = model([circle('a', -5), circle('b', 5, 3), feature({ separateBodies: true })]);
  expect(result.values).toHaveLength(2);
  result.values.forEach(value => expect(value.volume).toBeCloseTo(Math.PI * 4 * 5, 5));
  expect(result.values.map(value => Math.round(value.min[2]) || 0).sort()).toEqual([0, 3]);
  expect(result.result.bodyOutputs?.e).toHaveLength(2);
});

it('fuses overlapping profile tools before reporting material', () => {
  const result = model([circle('a', 0), circle('b', 0, 3), feature({ separateBodies: true })]);
  expect(result.values).toHaveLength(1);
  expect(result.values[0].volume).toBeCloseTo(Math.PI * 4 * 8, 5);
});

it('keeps shared direction and independent extents on both profile planes', () => {
  const result = model([circle('a', -10), circle('b', 10, 20), feature({ separateBodies: true, directionVector: [0, .6, .8],
    startingOffsetMillimeters: 2, secondEnd: { endType: 'blind', distanceMillimeters: 3 } })]);
  result.values.forEach(value => expect(value.volume).toBeCloseTo(Math.PI * 4 * 8 * .8, 5));
  expect(result.values.map(value => Number(value.min[2].toFixed(4))).sort((a,b)=>a-b)).toEqual([-.8, 19.2]);
});

it('builds open Thin walls from each selected sketch with exact total volume', () => {
  const result = model([line('a', -5), line('b', 5, 3), feature({ separateBodies: true, thin: { thickness1Millimeters: 1, thickness2Millimeters: 0 } })]);
  expect(result.values.reduce((sum, value) => sum + value.volume, 0)).toBeCloseTo(100, 5);
});

it('builds native surface sheets from curves on multiple planes', () => {
  const result = model([line('a', -5), line('b', 5, 3), { ...feature(), type: 'surface-extrude', operation: 'new' }]);
  expect(result.values.reduce((sum, value) => sum + value.area, 0)).toBeCloseTo(100, 5);
  expect(result.values[0].min[2]).toBeCloseTo(0, 5);
  expect(result.values[0].max[2]).toBeCloseTo(8, 5);
});

it('never accepts only the surviving source when another selection disappears', () => {
  const broken = feature(); broken.profileSelections![1].profileContourId = 'missing';
  expect(() => model([circle('a', -5), circle('b', 5), broken])).toThrow(/no longer|unavailable/);
});

it('uses a single shared direction for differently oriented sketch planes', () => {
  const b = { ...circle('b', 15), frame: { originMillimeters: [10,0,10] as [number,number,number], normal: [0,.6,.8] as [number,number,number], xDirection: [1,0,0] as [number,number,number] } };
  const result = model([circle('a', -5), b, feature({ separateBodies: true })]);
  expect(result.values.map(value => value.volume).sort((a,b)=>a-b)).toEqual([expect.closeTo(Math.PI*4*5*.8,5),expect.closeTo(Math.PI*4*5,5)]);
});

it('retains every output identity through source reordering, primary-source removal and saved reopen', () => {
  let doc: PartDocument = { ...createEmptyPartDocument('Stable selection'), documentId: 'multi', features: [circle('a', -5), circle('b', 5)] };
  doc = insertFeature(doc, feature({ separateBodies: true }));
  const initial = model(doc.features), original = doc.features.at(-1) as ExtrudeFeature;
  expect(original.outputProfileId).toBe('a');
  const reordered = { ...original, profileFeatureId: 'b', profileSelections: [...original.profileSelections!].reverse(), bodyOutputs: initial.result.bodyOutputs!.e };
  expect(model([...doc.features.slice(0, -1), reordered]).properties).toEqual(initial.properties);
  const retained = model([...doc.features.slice(0, -1), { ...reordered, profileSelections: [reordered.profileSelections[0]] }]);
  const expectedId = Object.entries(initial.properties).find(([, p]) => p.min[0] > 0)![0];
  expect(Object.keys(retained.properties)).toEqual([expectedId]);
  expect(retained.properties[expectedId]).toEqual(initial.properties[expectedId]);
});

it('preserves a previously authored single-source body when a second sketch is added', () => {
  let doc: PartDocument = { ...createEmptyPartDocument('Expanded selection'), documentId: 'multi', features: [circle('a', -5), circle('b', 5)] };
  doc = insertFeature(doc, feature({ separateBodies: true, profileSelections: [{ profileFeatureId: 'a', profileContourId: 'same-name' }] }));
  const original = model(doc.features), e = doc.features.at(-1) as ExtrudeFeature;
  const expanded = model([...doc.features.slice(0, -1), { ...e, profileSelections: feature().profileSelections }]);
  const id = Object.keys(original.properties)[0];
  expect(expanded.properties[id]).toEqual(original.properties[id]);
});

it.each(['add', 'cut', 'intersect'] as const)('applies a multi-source %s once across the selected part scope', operation => {
  const a = circle('base-a', -5), b = circle('base-b', 5);
  if (a.profile.type === 'drawing' && a.profile.contours[0].type === 'circle') a.profile.contours[0].radius = 4;
  if (b.profile.type === 'drawing' && b.profile.contours[0].type === 'circle') b.profile.contours[0].radius = 4;
  const padA = { ...feature(), id: 'pad-a', profileFeatureId: a.id, profileSelections: undefined, distanceMillimeters: 10 };
  const padB = { ...padA, id: 'pad-b', profileFeatureId: b.id };
  const initial = [a, padA, b, padB];
  const before = model(initial);
  const z = operation === 'intersect' ? 0 : 10;
  const cut = feature({ operation, scopeMode: 'all' });
  const after = model([...initial, circle('a', -5, z), circle('b', 5, z), cut]);
  expect(Object.keys(after.properties).sort()).toEqual(Object.keys(before.properties).sort());
  const expected = operation === 'add' ? 180 : operation === 'cut' ? 140 : 20;
  after.values.forEach(value => expect(value.volume).toBeCloseTo(expected * Math.PI, 5));
});

it('resolves the same stopping plane separately from each source sketch origin', () => {
  const stop = { ...circle('stop-profile', 0, 20), profile: { type: 'polygon' as const, pointsMillimeters: [[-20,-20],[20,-20],[20,20],[-20,20]] as [number,number][] } };
  const pad = { ...feature(), id: 'stop', profileFeatureId: stop.id, profileSelections: undefined, distanceMillimeters: 2 };
  const doc = { ...createEmptyPartDocument("Stops"), documentId: 'multi', features: [stop, pad] };
  const endReference = { sourceFeatureId: pad.id, bodyId: bodyIDForFeature(doc, pad), normal: [0,0,-1] as [number,number,number], label: 'Stop' };
  const result = model([stop, pad, circle('a', -5), circle('b', 5, 5), feature({ separateBodies: true, endType: 'up-to-face', endReference })]);
  const outputs = result.result.bodyOutputs!.e.map(id => result.properties[id]);
  expect(outputs.map(value => value.volume).sort((a,b)=>a-b)).toEqual([expect.closeTo(60*Math.PI,5),expect.closeTo(80*Math.PI,5)]);
  outputs.forEach(value => expect(value.max[2]).toBeCloseTo(20,5));
});
