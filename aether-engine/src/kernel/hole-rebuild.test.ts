import { beforeAll, afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { measureVolume, setOC, type Shape3D } from 'replicad';
import { parsePartDocument, type PartDocument, type HoleFeature } from '../document';
import { evaluatePartDocument, resetEvaluationCache, snapshotEvaluation, restoreEvaluation } from './part-evaluator';
import { writeBrep } from './brep-bytes';

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) }));
}, 30000);
afterEach(resetEvaluationCache);

const fixture = () => parsePartDocument(readFileSync(new URL('../../../dev/docs/reality/data/Feature_Layout_First_Pass_Hole_Repro_2026_11_05.part.json', import.meta.url), 'utf8'));
const hole = (document: PartDocument): HoleFeature => ({
  id: 'hole-rebuild', type: 'hole', name: 'Hole', suppressed: false,
  placement: { kind: 'sketch-points', points: [{ kind: 'sketch-point', sourceFeatureId: document.features[2].id,
    contourId: `${document.features[2].id}-c0-0`, point: 'center', label: 'Circle center' }] },
  targetBodyId: (document.features.at(-1) as { targetBodyId: string }).targetBodyId,
  cutType: 'plain', diameterMillimeters: 4, depthType: 'blind', depthMillimeters: 6,
});
function volume(document: PartDocument, preview = false): number {
  let result = 0;
  evaluatePartDocument(document, { preview, withBodies: bodies => {
    for (const body of bodies.values()) result += measureVolume(body);
  } });
  return result;
}

it('preserves the exact upstream solid through Hole previews, saved rebuild and replay restoration', () => {
  const base = fixture();
  let stock!: Shape3D;
  evaluatePartDocument(base, { withBodies: bodies => { stock = [...bodies.values()][0]; } });
  const before = measureVolume(stock), bytes = writeBrep(stock);
  const drilled = { ...base, features: [...base.features, hole(base)] };
  for (const depth of [2, 6, 4, 6]) {
    const edited = { ...drilled, features: [...base.features, { ...hole(base), depthMillimeters: depth }] };
    expect(before - volume(edited, true)).toBeCloseTo(Math.PI * 4 * depth, 6);
    expect(writeBrep(stock)).toEqual(bytes);
  }
  expect(before - volume(drilled)).toBeCloseTo(Math.PI * 4 * 6, 6);
  const snapshot = snapshotEvaluation(drilled)!;
  expect(snapshot).toBeDefined();
  resetEvaluationCache();
  expect(restoreEvaluation(drilled, snapshot)).toBe(drilled.features.length);
  expect(before - volume(drilled, true)).toBeCloseTo(Math.PI * 4 * 6, 6);
  resetEvaluationCache();
  expect(before - volume(parsePartDocument(JSON.stringify(drilled)))).toBeCloseTo(Math.PI * 4 * 6, 6);
}, 30000);

it('reuses unchanged history after JSON object-key reordering and rebuilds only the edited Hole', () => {
  const base = fixture();
  const drilled: PartDocument = { ...base, features: [...base.features, hole(base)] };
  const initial = volume(drilled);
  // Saved containers and editor copies may construct equivalent objects in a
  // different property order. Array order remains authored modeling intent.
  const reordered: PartDocument = JSON.parse(JSON.stringify(drilled, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).reverse());
    return value;
  }));
  const repeated = evaluatePartDocument(reordered);
  expect(repeated.replayedFeatures).toBe(0);
  expect(volume(reordered)).toBeCloseTo(initial, 6);
  const edited: PartDocument = { ...reordered, features: [...reordered.features.slice(0, -1), { ...hole(base), depthMillimeters: 2 }] };
  expect(evaluatePartDocument(edited).replayedFeatures).toBe(1);
  expect(volume(edited) - initial).toBeCloseTo(Math.PI * 4 * 4, 6);
  const snapshot = snapshotEvaluation(edited)!;
  resetEvaluationCache();
  const saved = parsePartDocument(JSON.stringify(edited));
  expect(restoreEvaluation(saved, snapshot)).toBe(edited.features.length);
  expect(volume(saved)).toBeCloseTo(initial + Math.PI * 4 * 4, 6);
}, 30000);
