import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
vi.mock('@aether/core/kernel', () => ({ OCCTWorkerClient: class { ready = Promise.resolve(); } }));
import { HostAetherCoreClient } from '../host-aether-core-client';
import { afterEach, expect, it, vi } from 'vitest';
import { availableBodies, createEmptyPartDocument, featureReferenceErrors, insertFeature, parsePartDocument, removeFeature, serializePartDocument, type PartDocument } from '@aether/core/document';
import { FeatureBuildError, rebuildRecovering, recordFeatureErrors, renderableDocument } from './feature-errors';
import { buildPartFeatureTree } from '../part-feature-tree';
import { translateDocument } from '../freecad-translate';

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
it('retains dangling descendants across delete, save/reopen, rollback and source restore', () => {
  const doc = referenceFixture();
  const deleted = parsePartDocument(serializePartDocument(removeFeature(doc, 'base')));
  expect(deleted.features.map(f => f.id)).toEqual(['base-sketch', 'attached', 'child', 'independent-sketch', 'independent']);
  expect([...featureReferenceErrors(deleted).keys()]).toEqual(['attached', 'child']);
  expect(deleted.features.every(f => !f.suppressed)).toBe(true);
  expect(availableBodies(deleted).map(b => b.id)).toEqual(['independent']);
  const visible = renderableDocument(deleted)!;
  expect(translateDocument(visible).features.map(f => f.id)).toEqual(['base-sketch', 'independent-sketch', 'independent']);
  expect(featureReferenceErrors({ ...deleted, rollbackIndex: 1 }).size).toBe(0);
  const restored = { ...deleted, features: [deleted.features[0], doc.features[1], ...deleted.features.slice(1)] };
  expect(featureReferenceErrors(parsePartDocument(serializePartDocument(restored))).size).toBe(0);
});
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

it('marks a removed contour and its downstream features without dropping their definitions', async () => {
  const doc = referenceFixture();
  const base = doc.features[1];
  if (base.type !== 'extrude') throw Error('fixture');
  base.profileContourId = 'deleted-contour';
  const translated = translateDocument(doc);
  expect(translated.untranslated.map(f => f.id)).toEqual(['base', 'attached', 'child']);
  expect(translated.features.some(f => f.id === 'independent')).toBe(true);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('native rebuild removes failed support branches, preserves independent solids, and restores them', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    const job = JSON.parse(options.body as string);
    const result = spawnSync(process.env.AETHER_PYTHON ?? "python3", ['-c', `
import sys,json,dataclasses
sys.path.insert(0,sys.argv[1])
from aether_freecad import FreeCADEngine
from aether_freecad.protocol import job_from_json
with FreeCADEngine() as engine:
 print(json.dumps(dataclasses.asdict(engine.build(job_from_json(json.load(sys.stdin))))))
`, `${root}freecad-engine`], { input: JSON.stringify({ ...job, protocol: 1 }), encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw Error(result.stderr || String(result.error));
    return new Response(result.stdout);
  }));
  const client = new HostAetherCoreClient();
  const doc = referenceFixture();
  const rebuild = (d: PartDocument) => rebuildRecovering(d, candidate => client.evaluatePart(candidate));
  const broken = structuredClone(doc);
  const attached = broken.features[2];
  if (attached.type !== 'profile' || !attached.support) throw Error('fixture');
  attached.support.normal = [0, 1, 0]; // A cylinder has no planar side face.
  const failed = await rebuild(broken);
  expect([...failed.failures.keys()]).toEqual(['attached', 'child']);
  expect(failed.model.parts.map(p => p.id)).toEqual(['base', 'independent']);
  const deleted = await rebuild(parsePartDocument(serializePartDocument(removeFeature(doc, 'base'))));
  expect(deleted.model.parts.map(p => p.id)).toEqual(['independent']);
  expect([...deleted.failures.keys()]).toEqual(['attached', 'child']);
  const emptyPart = await rebuild(removeFeature(removeFeature(doc, 'base'), 'independent'));
  expect(emptyPart.model.parts).toEqual([]);
  expect([...emptyPart.failures.keys()]).toEqual(['attached', 'child']);
  const restored = await rebuild(doc);
  expect(restored.failures.size).toBe(0);
  expect(restored.model.parts.map(p => p.id)).toEqual(['base', 'child', 'independent']);
  expect(restored.model.parts.every(p => p.vertices.length > 0)).toBe(true);
}, 120000);
