import { expect, it, vi } from 'vitest';
import { CachedDisplayEvaluator, type DisplayStorage } from './display-cache';
import type { PartDocument } from '../part-document';
import type { ImportedModelData } from '../domain';
const document = (depth = 5) => ({documentId: 'part', features: [{type: 'extrude', distanceMillimeters: depth}]}) as PartDocument;
const mesh = () => ({parts: [{id: 'body', vertices: new Float32Array(9), normals: new Float32Array(9), triangles: new Uint32Array([0,1,2]), edgeLines: new Float32Array(6), topology: [], faceRanges: []}]}) as unknown as ImportedModelData;
const storage = () => {
  const entries = new Map();
  return {read: vi.fn(async key => structuredClone(entries.get(key))), write: vi.fn(async value => {entries.set(value.key, structuredClone(value));})} satisfies DisplayStorage;
};
it('reopens the same native source without rebuilding and preserves transferred buffer types', async () => {
  const disk = storage(), build = vi.fn(async () => mesh());
  const first = await new CachedDisplayEvaluator('engine-a', disk, build).evaluatePart(document());
  const reopened = await new CachedDisplayEvaluator('engine-a', disk, build).evaluatePart(document());
  expect(build).toHaveBeenCalledTimes(1);
  expect(reopened).toEqual(first);
  expect(reopened.parts[0].vertices).toBeInstanceOf(Float32Array);
});
it('rebuilds after a source edit or engine change, while undo can reuse only its exact source', async () => {
  const disk = storage(), build = vi.fn(async () => mesh());
  const current = new CachedDisplayEvaluator('engine-a', disk, build);
  await current.evaluatePart(document()); await current.evaluatePart(document(6));
  await current.evaluatePart(document());
  await new CachedDisplayEvaluator('engine-b', disk, build).evaluatePart(document());
  expect(build).toHaveBeenCalledTimes(3);
});
it('builds the captured source if the caller changes its object during a storage read', async () => {
  const disk = storage(), build = vi.fn(async (_document: PartDocument) => mesh()), input = document();
  disk.read.mockImplementationOnce(async () => { Object.assign(input.features[0], {distanceMillimeters: 9}); return undefined; });
  await new CachedDisplayEvaluator('engine-a', disk, build).evaluatePart(input);
  expect(build.mock.calls[0][0]).toEqual(document(5));
  expect(JSON.parse(disk.write.mock.calls[0][0].source)).toEqual(document(5));
});
it('rebuilds malformed/mismatched entries and survives unavailable storage without caching failures', async () => {
  const disk = storage(), build = vi.fn(async () => mesh());
  const current = new CachedDisplayEvaluator('engine-a', disk, build);
  await current.evaluatePart(document());
  const good = disk.write.mock.calls[0][0];
  disk.read.mockResolvedValueOnce({...good, source: 'different'});
  await current.evaluatePart(document());
  disk.read.mockResolvedValueOnce({...good, model: {parts: [{}]}});
  await current.evaluatePart(document());
  disk.read.mockRejectedValueOnce(Error('unavailable')); disk.write.mockRejectedValueOnce(Error('quota'));
  await expect(current.evaluatePart(document())).resolves.toEqual(mesh());
  build.mockRejectedValueOnce(Error('bad feature'));
  disk.read.mockResolvedValueOnce(undefined);
  const writes = disk.write.mock.calls.length;
  await expect(current.evaluatePart(document())).rejects.toThrow('bad feature');
  expect(disk.write).toHaveBeenCalledTimes(writes);
});
