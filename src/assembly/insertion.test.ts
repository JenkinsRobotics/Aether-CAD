import { describe, it, expect, vi, afterEach } from 'vitest';
import { appendSolidPrimitive, defaultPrimitiveDimensions } from '../modeling/solid-primitives';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { designInsertCandidates, insertionRecipe, type InsertSource } from './insertion';
import { configureAssemblyInsertion, insertAssemblySource, parseInsertDrag } from './insertion-session';
import { readInsertSource } from './insertion-sources';
vi.mock('./insertion-sources', () => ({ readInsertSource: vi.fn() }));
const document = appendSolidPrimitive(null, 'box', defaultPrimitiveDimensions);
const projection = { workspace_id: 'design', assembly_id: 'assembly',
  part_definitions: [{ id: 'part', name: 'Bracket', feature_document: document }, { id: 'empty', name: 'Unfinished' }],
  assemblies: [{ id: 'assembly', name: 'Main' }, { id: 'subassembly', name: 'Mechanism' }],
  instances: [{ id: 'first', name: 'Bracket:1', definition_id: 'part' }, { id: 'third', name: 'Bracket:3', definition_id: 'part' }],
} as unknown as AssemblyProjectionV1;
const source: InsertSource = { kind: 'design-part', workspaceId: 'design', partId: 'part' };
const saved: InsertSource = { kind: 'saved-part', fileId: 'file', revision: 7, partId: 'inner' };
const placement = { positionM: [0.025, -0.01, 0.1] as const, grounded: true };
afterEach(() => { configureAssemblyInsertion(null); vi.clearAllMocks(); });
describe('Assembly source insertion', () => {
  it('anchors the first drag or picker insertion and leaves later occurrences free', () => {
    const empty={...projection,instances:[]};
    expect(insertionRecipe(empty,source,{...placement,grounded:false}).instances[0].grounded).toBe(true);
    const anchored={...projection,instances:[{...projection.instances[0],grounded:true,suppressed:false}]};
    expect(insertionRecipe(anchored,source,{...placement,grounded:false}).instances[0].grounded).toBe(false);
    expect(insertionRecipe({...anchored,instances:[{...anchored.instances[0],suppressed:true}]},source,{...placement,grounded:false}).instances[0].grounded).toBe(true);
  });
  it('reuses a Hybrid definition with explicit unit conversion and a unique occurrence name', () => {
    expect(insertionRecipe(projection, source, placement)).toEqual({ version: 1,
      parts: [{ key: 'source', part_id: 'part' }],
      instances: [{ key: 'Bracket:2', part: 'source', position_mm: [25, -10, 100], grounded: true }] });
  });
  it('copies actual geometry from an external revision, without a false live-link promise', () => {
    const result = insertionRecipe(projection, saved, placement, { name: 'External', document });
    expect(result.parts[0]).toMatchObject({ name: 'External', document });
    expect(result.parts[0]).not.toHaveProperty('part_id');
  });
  it('explains unfinished Parts and unsupported subassemblies, excludes the active Assembly', () => {
    const items = designInsertCandidates(projection);
    expect(items.map(item => item.id)).toEqual(['part', 'empty', 'subassembly']);
    expect(items[0].document).toBeDefined(); expect(items[1].unavailable).toBeTruthy();
    expect(items[2].unavailable).toContain('Nested subassembly');
  });
  it('refuses stale, foreign and invalid insertion targets before composing', () => {
    expect(() => insertionRecipe(projection, { ...source, workspaceId: 'other' }, placement)).toThrow('different design');
    expect(() => insertionRecipe(projection, { ...source, partId: 'gone' }, placement)).toThrow('no longer');
    expect(() => insertionRecipe(projection, source, { ...placement, positionM: [NaN, 0, 0] })).toThrow('finite');
    expect(() => insertionRecipe(projection, source, { ...placement, positionM: [1001, 0, 0] })).toThrow('finite');
  });
  it('routes picker and drag sources through the same atomic recipe operation', async () => {
    const insert = vi.fn(async (_recipe, _signal, assertCurrent) => assertCurrent());
    configureAssemblyInsertion({ projection: () => projection, editable: () => true, insert });
    await insertAssemblySource(parseInsertDrag(JSON.stringify(source)), placement);
    expect(insert).toHaveBeenCalledWith(insertionRecipe(projection, source, placement), expect.any(AbortSignal), expect.any(Function));
    expect(readInsertSource).not.toHaveBeenCalled();
  });
  it('refuses an external read that finishes after changing the active Assembly', async () => {
    let current = projection;
    const insert = vi.fn();
    vi.mocked(readInsertSource).mockImplementation(async () => { current = { ...projection }; return { name: 'External', document }; });
    configureAssemblyInsertion({ projection: () => current, editable: () => true, insert });
    await expect(insertAssemblySource(saved, placement)).rejects.toThrow('changed');
    expect(insert).not.toHaveBeenCalled();
  });
  it('does not load sources or mutate read-only Assemblies', async () => {
    const insert = vi.fn(); configureAssemblyInsertion({ projection: () => projection, editable: () => false, insert });
    await expect(insertAssemblySource(saved, placement)).rejects.toThrow('editable');
    expect(insert).not.toHaveBeenCalled(); expect(readInsertSource).not.toHaveBeenCalled();
  });
  it('rejects malformed drag payloads and preserves explicit source revision', () => {
    expect(parseInsertDrag(JSON.stringify(saved))).toMatchObject(saved);
    for (const value of ['{}', '{"kind":"saved-part","fileId":"x","revision":-1}', 'x'.repeat(4097)])
      expect(() => parseInsertDrag(value)).toThrow();
  });
});
