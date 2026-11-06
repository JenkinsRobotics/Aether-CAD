import { expect, it } from 'vitest';
import { createRectanglePartDocument, availableBodies } from '@aether/core/document';
import type { ImportedModelData } from '@aether/core/contracts';
import { inspectNativeTopology } from './topology-inspection';
import { validateLiveArguments } from './live-commands';

it('pages native candidates across face boundaries and omits display polylines', () => {
  const doc = createRectanglePartDocument('Plate', { widthMillimeters: 20, heightMillimeters: 10, depthMillimeters: 5 });
  const bodyId = availableBodies(doc)[0].id;
  const candidate = (id: string) => ({ id, kind: 'edge-midpoint', label: id, origin: [1, 2, 3],
    measurements: { lengthMillimeters: 4 }, polylineMillimeters: Array(20000).fill(1) });
  const model = { parts: [{ id: bodyId, topology: [
    { id: 1, surfaceType: 'PLANE', candidates: [candidate('a'), candidate('b')] },
    { id: 2, surfaceType: 'PLANE', candidates: [candidate('c')] },
  ] }] } as unknown as ImportedModelData;
  const first = inspectNativeTopology(doc, model, { body_id: bodyId, limit: 2 });
  expect(first).toMatchObject({ total_candidates: 3, total_faces: 2, next_offset: 2 });
  expect(first.faces[0].candidates).toHaveLength(2);
  expect(JSON.stringify(first)).not.toContain('polylineMillimeters');
  expect(JSON.stringify(first).length).toBeLessThan(4000);
  const second = inspectNativeTopology(doc, model, { body_id: bodyId, offset: 2, limit: 2 });
  expect(second).toMatchObject({ next_offset: null, faces: [{ id: 2, candidates: [{ id: 'c' }] }] });
  expect(() => validateLiveArguments('aether_cad_topology', { body_id: bodyId, limit: 6 })).toThrow();
});
