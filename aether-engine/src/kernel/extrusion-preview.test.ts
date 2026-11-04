import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, measureVolume } from 'replicad';
import { evaluatePartDocument } from './part-evaluator';
import { createEmptyPartDocument, type PartFeature } from '../document/index';

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) }));
}, 30000);

function preview(parameters: Record<string, unknown>) {
  const doc = createEmptyPartDocument('Native extrusion handles');
  doc.features.push(
    { id: 's', type: 'profile', name: 'Rectangle', plane: 'XY', offsetMillimeters: 0, suppressed: false,
      profile: { type: 'polygon', pointsMillimeters: [[0, 0], [20, 0], [20, 10], [0, 10]] } } as PartFeature,
    { id: 'pt', type: 'profile', name: 'Stop', plane: 'XY', offsetMillimeters: 20, suppressed: false, profile: { type: 'drawing', contours: [{ type: 'circle', id: 'stop', center: [0, 0], radius: 1 }] } } as PartFeature,
    { id: 'e', type: 'extrude', name: 'Extrude', profileFeatureId: 's', distanceMillimeters: 10, operation: 'new', suppressed: false, ...parameters } as PartFeature,
  );
  let volume = 0;
  const model = evaluatePartDocument(doc, { preview: true, withBodies: bodies => { for (const body of bodies.values()) volume += measureVolume(body); } });
  return { ...model, volume };
}
const rounded = (v: number[]) => v.map(n => Number(n.toFixed(6)));

it('places a shifted, oblique extrusion handle on its actual native end', () => {
  const result = preview({ directionVector: [0.6, 0, 0.8], startingOffsetMillimeters: 5 });
  const [axis] = result.featurePreview!.extrusionAxes!;
  expect(rounded(axis.originMillimeters)).toEqual([13, 5, 4]);
  expect(axis.direction).toEqual([0.6, 0, 0.8]);
  const end = axis.originMillimeters.map((p, i) => p + 10 * axis.direction[i]);
  expect(rounded(end)).toEqual([19, 5, 12]);
  expect(result.volume).toBeCloseTo(20 * 10 * 10 * .8, 5);
  const offset = result.previewHandles!.find(handle => handle.parameter === 'offset')!;
  expect(offset).toMatchObject({ signed: true, direction: [.6, 0, .8] });
  expect(rounded(offset.originMillimeters)).toEqual([10, 5, 0]);
});

it('offers both symmetric handles and independent reversed second ends', () => {
  const symmetric = preview({ endType: 'symmetric', startingOffsetMillimeters: 3 }).featurePreview!.extrusionAxes!;
  expect(symmetric.map(a => [a.side, a.parameter, a.scale])).toEqual([['primary', 'distance', 0.5], ['opposite', 'distance', 0.5]]);
  expect(symmetric.map(a => rounded(a.originMillimeters))).toEqual([[10, 5, 3], [10, 5, 3]]);
  expect(symmetric.map(a => rounded(a.direction))).toEqual([[0, 0, 1], [0, 0, -1]]);
  const opposite = preview({ reversed: true, secondEnd: { endType: 'blind', distanceMillimeters: 4 } }).featurePreview!.extrusionAxes!;
  expect(opposite[1]).toMatchObject({ parameter: 'second', scale: 1, reversed: true });
  expect(rounded(opposite[0].direction)).toEqual([0, 0, -1]);
  expect(rounded(opposite[1].direction)).toEqual([0, 0, 1]);
});

it('does not expose an unused depth for a stop-bound primary end', () => {
  const result = preview({ endType: 'up-to-vertex', endPointReference: { kind: 'sketch-point', sourceFeatureId: 'pt', contourId: 'stop', point: 'center', label: 'Stop' } });
  expect(result.featurePreview?.extrusionAxes ?? []).toEqual([]);
});
