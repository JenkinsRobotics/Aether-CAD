import { describe, expect, it, vi } from 'vitest';
import { AssemblyGeometryCache } from './geometry-cache';

const model = () => ({ parts: [{ vertices: new Float32Array(30), normals: new Float32Array(30),
  triangles: new Uint32Array(12), edgeLines: new Float32Array(12), topology: [], faceRanges: [] }] }) as never;
const dependencies = () => ({ parseDocument: vi.fn(JSON.parse), evaluate: vi.fn(async () => model()) });

describe('assembly definition geometry', () => {
  it('coalesces concurrent occurrences and reuses their immutable geometry on later placements', async () => {
    const deps = dependencies(), cache = new AssemblyGeometryCache(deps);
    const first = cache.get('part', '{"depth":5}');
    expect(cache.get('part', '{"depth":5}')).toBe(first);
    const result = await first;
    expect(await cache.get('part', '{"depth":5}')).toBe(result);
    expect(deps.evaluate).toHaveBeenCalledTimes(1);
  });

  it('invalidates edits, undo, and reused IDs with different content', async () => {
    const deps = dependencies(), cache = new AssemblyGeometryCache(deps);
    const a = await cache.get('part', '{"depth":5}');
    const b = await cache.get('part', '{"depth":6}');
    expect(b).not.toBe(a);
    expect(b.document).toEqual({ depth: 6 });
    expect((await cache.get('part', '{"depth":5}')).document).toEqual({ depth: 5 });
    expect(deps.evaluate).toHaveBeenCalledTimes(3);
  });

  it('does not retain failed builds or let old completions replace newer content', async () => {
    const deps = dependencies(), cache = new AssemblyGeometryCache(deps);
    let reject!: (error: Error) => void;
    deps.evaluate.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const old = cache.get('part', '{"depth":5}');
    await Promise.resolve();
    const fresh = await cache.get('part', '{"depth":6}');
    const failed = expect(old).rejects.toThrow('failed');
    reject(Error('failed')); await failed;
    expect(await cache.get('part', '{"depth":6}')).toBe(fresh);
    await cache.get('part', '{"depth":5}');
    expect(deps.evaluate).toHaveBeenCalledTimes(3);
  });

  it('bounds retained bytes/entries and clears document-session data', async () => {
    const deps = dependencies(), cache = new AssemblyGeometryCache(deps, 2000, 2);
    await cache.get('a', '{}'); await cache.get('b', '{}');
    await cache.get('a', '{}'); await cache.get('c', '{}');
    await cache.get('b', '{}');
    expect(deps.evaluate).toHaveBeenCalledTimes(4);
    cache.clear(); await cache.get('b', '{}');
    expect(deps.evaluate).toHaveBeenCalledTimes(5);
    const tiny = new AssemblyGeometryCache(deps, 1);
    await tiny.get('a', '{}'); await tiny.get('a', '{}');
    expect(deps.evaluate).toHaveBeenCalledTimes(7);
  });
});
