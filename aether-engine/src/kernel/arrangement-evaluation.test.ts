import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { measureVolume, setOC } from 'replicad';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, sketchRegions, type PartDocument, type ProfileFeature } from '../document/index';
import type { SketchContour, SketchDrawing } from '../sketch/drawing';
import { evaluatePartDocument, resetEvaluationCache } from './part-evaluator';
import { editDrawingDimension } from '../sketch/operations/edit-dimension';

beforeAll(async () => { setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })); }, 30000);
const rectangle = (): SketchContour => ({ type: 'path', id: 'rectangle', start: [0, -10], segments: [
  { type: 'line', end: [20, -10] }, { type: 'line', end: [20, 10] }, { type: 'line', end: [0, 10] }, { type: 'line', end: [0, -10] },
] });
const sketch = (contours: SketchContour[]): ProfileFeature => ({ id: 'sketch', type: 'profile', name: 'Sketch', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: { type: 'drawing', contours } });
function documentFor(feature: ProfileFeature, choose: (regions: ReturnType<typeof sketchRegions>) => ReturnType<typeof sketchRegions>) {
  const regions = choose(sketchRegions(feature));
  const selections = regions.map(r => ({ profileFeatureId: feature.id, profileRegion: { contourIds: r.sourceContourIds!, inside: r.insideContourIds, ordinal: r.ordinal, boundary: r.boundary } }));
  const doc = createEmptyPartDocument('Region part');
  doc.features = [feature, { id: 'pad', name: 'Extrude', type: 'extrude', suppressed: false, profileFeatureId: feature.id, profileSelections: selections, regionMode: 'faces', operation: 'new', separateBodies: true, distanceMillimeters: 5 }];
  return doc;
}
function measure(doc: PartDocument) {
  const volumes: number[] = [];
  const model = evaluatePartDocument(doc, { withBodies: bodies => { for (const body of bodies.values()) volumes.push(measureVolume(body)); } });
  return { model, volumes, volume: volumes.reduce((sum, v) => sum + v, 0) };
}
const overlap = () => sketch([rectangle(), { id: 'circle', type: 'circle', center: [20, 0], radius: 10 }]);
const lens = (regions: ReturnType<typeof sketchRegions>) => regions.filter(r => r.insideContourIds?.length === 2);

it('extrudes only the picked overlap using exact arcs; editing its dimension rebuilds the same body after reopen', () => {
  const source = overlap();
  (source.profile as SketchDrawing).constraints = [{ id: 'radius', kind: 'radius', a: { kind: 'circle', contour: 1 }, value: 10 }];
  const doc = documentFor(source, lens);
  const first = measure(doc);
  expect(first.volume).toBeCloseTo(Math.PI * 50 * 5, 5);
  expect(first.model.parts).toHaveLength(1);
  const before = serializePartDocument(doc);
  source.profile = editDrawingDimension(source.profile as SketchDrawing, 'radius', 8);
  const saved = parsePartDocument(serializePartDocument(doc));
  const edited = measure(saved);
  expect(edited.volume).toBeCloseTo(Math.PI * 32 * 5, 5);
  expect(edited.model.parts[0].id).toBe(first.model.parts[0].id);
  resetEvaluationCache();
  expect(measure(saved).volume).toBeCloseTo(edited.volume, 7);
  expect(measure(parsePartDocument(before)).volume).toBeCloseTo(first.volume, 7);
});

it('builds a ring and its disc independently or together, with no double counting', () => {
  const source = sketch([rectangle(), { id: 'circle', type: 'circle', center: [10, 0], radius: 4 }]);
  expect(measure(documentFor(source, r => r.filter(c => c.holes?.length))).volume).toBeCloseTo((400 - Math.PI * 16) * 5, 5);
  expect(measure(documentFor(source, r => r.filter(c => !c.holes?.length))).volume).toBeCloseTo(Math.PI * 16 * 5, 5);
  expect(measure(documentFor(source, r => r)).volume).toBeCloseTo(400 * 5, 5);
});

it('splits a rectangle at a divider, and gives distinct stable body IDs to the two choices', () => {
  const source = sketch([rectangle(), { id: 'divider', type: 'path', start: [8, -15], segments: [{ type: 'line', end: [8, 15] }] }]);
  const choices = sketchRegions(source);
  expect(choices).toHaveLength(2);
  const results = choices.map(choice => measure(documentFor(source, () => [choice])));
  expect(results.map(r => r.volume).sort((a, b) => a - b)).toEqual([expect.closeTo(800, 5), expect.closeTo(1200, 5)]);
  expect(new Set(results.map(r => r.model.parts[0].id)).size).toBe(2);
  expect(measure(documentFor(source, r => r)).volume).toBeCloseTo(2000, 5);
});

it('keeps legacy contour selections and whole-sketch geometry unchanged', () => {
  const doc = documentFor(overlap(), lens);
  const feature = doc.features[1] as any;
  delete feature.profileSelections; delete feature.regionMode;
  feature.profileContourId = 'rectangle';
  expect(measure(doc).volume).toBeCloseTo(2000, 5);
  delete feature.profileContourId;
  expect(measure(doc).volume).toBeCloseTo((400 + Math.PI * 50) * 5, 5);
});

it.each(['cut', 'add'] as const)('uses the same cell for %s on an earlier body', operation => {
  const source = overlap(); source.offsetMillimeters = 10;
  const doc = documentFor(source, lens);
  const selected = doc.features[1] as any;
  selected.operation = operation; delete selected.separateBodies;
  const base = sketch([rectangle()]); base.id = 'base';
  doc.features.unshift(base, { id: 'base-pad', name: 'Base', type: 'extrude', suppressed: false, profileFeatureId: 'base', operation: 'new', distanceMillimeters: 10 });
  expect(measure(doc).volume).toBeCloseTo(4000 + (operation === 'cut' ? -1 : 1) * Math.PI * 50 * 5, 5);
});

it('follows contributor IDs through reorder and refuses a removed overlap instead of selecting a whole contour', () => {
  const doc = documentFor(overlap(), lens), source = doc.features[0] as ProfileFeature;
  (source.profile as SketchDrawing).contours.reverse();
  expect(measure(doc).volume).toBeCloseTo(Math.PI * 250, 5);
  ((source.profile as SketchDrawing).contours[0] as any).center = [60, 0];
  expect(() => measure(doc)).toThrow(/no longer form/);
});

it('keeps the chosen side of a divider when the sketch rotates, without position-based retargeting', () => {
  const source = sketch([rectangle(), { id: 'divider', type: 'path', start: [8, -15], segments: [{ type: 'line', end: [8, 15] }] }]);
  const doc = documentFor(source, r => [r[0]]);
  const initial = measure(doc);
  const rotate = ([x, y]: [number, number]): [number, number] => [-x, -y];
  for (const contour of (source.profile as SketchDrawing).contours) if (contour.type === 'path') {
    contour.start = rotate(contour.start);
    for (const segment of contour.segments) segment.end = rotate(segment.end);
  }
  const result = measure(parsePartDocument(serializePartDocument(doc)));
  expect(result.volume).toBeCloseTo(initial.volume, 7);
  expect(result.model.parts[0].id).toBe(initial.model.parts[0].id);
});

it('extrudes exact divided rational-conic regions without flattening the curve', () => {
  const source = sketch([
    { id:'cap',type:'path',start:[-10,0],segments:[{type:'conic',control:[0,20],rho:0.5,end:[10,0]},{type:'line',end:[-10,0]}] },
    { id:'divider',type:'path',start:[-20,3],segments:[{type:'line',end:[20,3]}] },
  ]);
  const choices = sketchRegions(source); expect(choices).toHaveLength(2);
  const volumes = choices.map(r=>measure(documentFor(source,()=>[r])).volume);
  expect(volumes.every(v=>v>0)).toBe(true);
  expect(volumes.reduce((a,b)=>a+b,0)).toBeCloseTo(2000/3,5);
});
