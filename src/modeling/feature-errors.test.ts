

vi.mock('@aether/core/kernel', () => ({ OCCTWorkerClient: class { ready = Promise.resolve(); } }));

import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, featureReferenceErrors, insertFeature, removeFeature, serializePartDocument, type PartDocument } from '@aether/core/document';
import { FeatureBuildError, rebuildRecovering, recordFeatureErrors } from './feature-errors';
import { buildPartFeatureTree } from '../part-feature-tree';

export function referenceFixture(): PartDocument {
  let doc = createEmptyPartDocument('Reference recovery');
  const sketch = (id: string) => ({ id, name: id, type: 'profile' as const, suppressed: false, plane: 'XY' as const, offsetMillimeters: 0, profile: { type: 'circle' as const, centerMillimeters: [0, 0] as [number, number], radiusMillimeters: 10 } });
  const pad = (id: string, profileFeatureId: string) => ({ id, name: id, type: 'extrude' as const, operation: 'new' as const, profileFeatureId, bodyId: id, distanceMillimeters: 10, suppressed: false });
  doc = insertFeature(doc, sketch('base-sketch'));
  doc = insertFeature(doc, pad('base', 'base-sketch'));
  doc = insertFeature(doc, { ...sketch('attached'), support: { sourceFeatureId: 'base', bodyId: 'base', normal: [0, 0, 1], xDirection: [1, 0, 0], label: 'Top face' } });
  doc = insertFeature(doc, pad('child', 'attached'));
  doc = insertFeature(doc, sketch('independent-sketch'));
  return insertFeature(doc, pad('independent', 'independent-sketch'));
}
const empty = { parts: [], sourceName: 'test', parseMilliseconds: 0 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('discards failed build geometry and rebuilds independent branches with original definitions intact', async () => {
  const doc = referenceFixture();
  const evaluate = vi.fn(async (candidate: PartDocument) => {
    if (!candidate.features.find(f => f.id === 'base')!.suppressed) throw new FeatureBuildError(new Map([['base', 'Invalid solid']]), 'Invalid solid');
    expect(candidate.features.filter(f => f.suppressed).map(f => f.id)).toEqual(['base', 'attached', 'child']);
    return empty;
  });
  const result = await rebuildRecovering(doc, evaluate);
  expect(evaluate).toHaveBeenCalledTimes(2);
  expect([...result.failures.keys()]).toEqual(['base', 'attached', 'child']);
  expect(result.document.features.every(f => !f.suppressed)).toBe(true);
  recordFeatureErrors(result.document, result.failures);
  const tree = buildPartFeatureTree(result.document);
  expect(tree.children.filter(f => f.error).map(f => f.id)).toEqual(['base', 'attached', 'child']);
  expect(tree.children.filter(f => f.kind === 'body').map(f => f.id)).toEqual(['independent']);
  expect(serializePartDocument(result.document)).not.toContain('Invalid solid');
});
it('does not reinterpret transport errors or unknown native feature errors as successful recovery', async () => {
  const doc = referenceFixture();
  await expect(rebuildRecovering(doc, async () => { throw Error('Offline'); })).rejects.toThrow('Offline');
  await expect(rebuildRecovering(doc, async () => { throw new FeatureBuildError(new Map([['unknown', 'Bad']]), 'Bad'); })).rejects.toThrow('Bad');
});
it('tracks each preceding modification of a body and pins implicit targets on deletion', () => {
  let doc = referenceFixture();
  doc = insertFeature(doc, { id: 'finish', name: 'Finish', type: 'fillet', radiusMillimeters: 1, targetBodyId: 'base', suppressed: false });
  doc = insertFeature(doc, { id: 'finish2', name: 'Finish 2', type: 'fillet', radiusMillimeters: 1, targetBodyId: 'base', suppressed: false });
  expect(featureReferenceErrors(doc, new Map([['finish', 'Bad fillet']])).has('finish2')).toBe(true);
  doc = insertFeature(doc, { id: 'implicit', name: 'Implicit', type: 'fillet', radiusMillimeters: 1, suppressed: false });
  const removed = removeFeature(doc, 'independent');
  expect(removed.features.at(-1)).toMatchObject({ targetBodyId: 'independent', suppressed: false });
  expect(featureReferenceErrors(removed).has('implicit')).toBe(true);
});
it('invalidates construction planes on deleted plane and body references', () => {
  let doc = referenceFixture();
  doc = insertFeature(doc, { id: 'plane', name: 'Plane', type: 'plane', suppressed: false, plane: 'XY', offsetMillimeters: 0 });
  doc = insertFeature(doc, { id: 'offset', name: 'Offset', type: 'plane', suppressed: false, plane: 'XY', offsetMillimeters: 0, definition: { method: 'offset', reference: { kind: 'feature', featureId: 'plane' }, distanceMillimeters: 5 } });
  expect(featureReferenceErrors(removeFeature(doc, 'plane')).has('offset')).toBe(true);
});


// The native recovery round trip runs on the Aether engine in the suites above; the FreeCAD
// integration variant went with the engine (archived).