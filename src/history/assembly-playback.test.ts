import { expect, it, vi } from 'vitest';
import { createRectanglePartDocument, type PartDocument } from '@aether/core/document';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { assemblyPlayback } from './assembly-playback';

it('replays source Parts in history order, shares occurrence builds and retains solved placements without writes', async () => {
  const first = createRectanglePartDocument('First', { widthMillimeters: 10, heightMillimeters: 20, depthMillimeters: 5 });
  const second = createRectanglePartDocument('Second', { widthMillimeters: 8, heightMillimeters: 9, depthMillimeters: 3 });
  const source = { workspace_id: 'w', assembly_id: 'a', part_definitions: [
    { id: 'p1', name: 'First', feature_document: first }, { id: 'p2', name: 'Second', feature_document: second },
  ], instances: ['p1', 'p1', 'p2'].map((id, i) => ({ id: `i${i}`, name: `Occurrence ${i}`, definition_kind: 'part', definition_id: id,
    visible: true, suppressed: false, solved_world_transform: { position_m: [i * .1, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] } })) } as unknown as AssemblyProjectionV1;
  const before = structuredClone(source);
  const evaluate = vi.fn(async (doc: PartDocument) => ({ sourceName: doc.name, parseMilliseconds: 1, parts: doc.rollbackIndex === 1 ? [] : [{
    id: 'body', name: 'Body', sourceDocumentId: doc.documentId, sourceName: doc.name, vertices: new Float32Array(9), normals: new Float32Array(9), triangles: new Uint32Array([0,1,2]), edgeLines: new Float32Array(), topology: [], faceRanges: [],
  }] }));
  const sequence = assemblyPlayback(source, evaluate);
  expect(sequence.features).toHaveLength(4);
  expect((await sequence.evaluate(1)).parts).toHaveLength(0);
  const two = await sequence.evaluate(2);
  expect(two.parts.map(p => p.id)).toEqual(['assembly:i0:body', 'assembly:i1:body']);
  expect(two.parts[0].vertices).toBe(two.parts[1].vertices);
  expect(two.placements?.get('assembly:i1:body')?.position).toEqual([100, 0, 0]);
  expect((await sequence.evaluate(3)).parts).toHaveLength(2);
  expect((await sequence.evaluate(4)).parts).toHaveLength(3);
  expect(evaluate).toHaveBeenCalledTimes(4);
  expect(source).toEqual(before);
});
it('does not enqueue later definitions after playback is stopped mid-frame', async () => {
  const doc = createRectanglePartDocument('Part', { widthMillimeters: 2, heightMillimeters: 3, depthMillimeters: 4 });
  const source = { workspace_id: 'w', assembly_id: 'a', part_definitions: ['a', 'b'].map(id => ({ id, name: id, feature_document: doc })),
    instances: ['a', 'b'].map(id => ({ id, name: id, definition_kind: 'part', definition_id: id, visible: true, suppressed: false,
      solved_world_transform: { position_m: [0, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] } })) } as unknown as AssemblyProjectionV1;
  let current = true;
  const evaluate = vi.fn(async () => { current = false; return { sourceName: 'Part', parts: [], parseMilliseconds: 0 }; });
  await assemblyPlayback(source, evaluate).evaluate(4, () => current);
  expect(evaluate).toHaveBeenCalledTimes(1);
});
