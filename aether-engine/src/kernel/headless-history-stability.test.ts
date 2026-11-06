import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { measureVolume } from 'replicad';
import { parsePartDocument, serializePartDocument, type PartDocument } from '../document';
import { initNodeKernel, runNodeOperation } from './node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from './part-evaluator';

beforeAll(async () => {
  await initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)));
}, 30000);
afterAll(resetEvaluationCache);

function plate(id: string, depth: number): PartDocument {
  return parsePartDocument(JSON.stringify({
    format: 'aether-part', formatVersion: 22, documentId: id, name: 'Plate', units: 'millimeter',
    features: [
      { id: 'sketch', name: 'Rectangle', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
        profile: { type: 'polygon', pointsMillimeters: [[0, 0], [20, 0], [20, 10], [0, 10]] } },
      { id: 'pad', name: 'Pad', type: 'extrude', profileFeatureId: 'sketch', distanceMillimeters: depth,
        operation: 'new', bodyId: 'body', suppressed: false },
    ],
  }));
}
const volume = (doc: PartDocument) => runNodeOperation(doc, () => {
  let result = 0;
  evaluatePartDocument(doc, { withBodies: bodies => { for (const body of bodies.values()) result += measureVolume(body); } });
  return result;
});

it('retains exact solids across edits, history restoration, cache eviction and failed candidates', async () => {
  for (let round = 0; round < 24; round++) {
    // Four documents exceed the three-document cache and exercise eviction too.
    const original = plate('plate-' + round % 4, 5);
    const edited = plate(original.documentId, 6 + round % 3);
    expect(await volume(original)).toBeCloseTo(1000, 6);
    expect(await volume(edited)).toBeCloseTo(200 * (6 + round % 3), 6);
    expect(await volume(original)).toBeCloseTo(1000, 6); // undo
    expect(await volume(parsePartDocument(serializePartDocument(edited)))).toBeCloseTo(200 * (6 + round % 3), 6); // redo/reopen
    const broken = plate(original.documentId, 5);
    (broken.features[1] as { profileFeatureId: string }).profileFeatureId = 'missing';
    await expect(volume(broken)).rejects.toThrow();
    expect(await volume(original)).toBeCloseTo(1000, 6);
  }
}, 60000);
