import { expect, it, vi } from 'vitest';
import { loadPartThumbnails } from './part-thumbnails';
import type { CADTabTarget } from '../document-tab-actions';

const target = (id: string): CADTabTarget => ({ id, itemId: id, documentId: null, name: id, kind: 'part', current: false });
const project = { parts: ['a', 'b', 'c'].map(id => ({ id, name: id, document: { name: id } })), assemblies: [] };
const dependencies = () => ({ read: vi.fn(), render: vi.fn(async (code: string) => JSON.parse(code).name as string), publish: vi.fn(), signal: new AbortController().signal });

it('previews every unopened Part from the loaded design without re-fetching the archive', async () => {
  const deps = dependencies();
  await loadPartThumbnails(['a', 'b', 'c'].map(target), project, deps);
  expect(deps.publish.mock.calls).toEqual([['a', 'a'], ['b', 'b'], ['c', 'c']]);
  expect(deps.read).not.toHaveBeenCalled();
});
it('stops abandoned work after a running preview and never publishes it into the new design', async () => {
  const deps = dependencies(), controller = new AbortController();
  deps.render.mockImplementationOnce(async () => { controller.abort(); return 'old'; });
  await loadPartThumbnails(['a', 'b', 'c'].map(target), project, { ...deps, signal: controller.signal });
  expect(deps.publish).not.toHaveBeenCalled(); expect(deps.render).toHaveBeenCalledTimes(1);
});
it('keeps later previews working when a Part is unavailable or has no renderable geometry', async () => {
  const deps = dependencies(); deps.render.mockRejectedValueOnce(Error('Unavailable'));
  await loadPartThumbnails(['a', 'b', 'c'].map(target), project, deps);
  expect(deps.publish.mock.calls).toEqual([['b', 'b'], ['c', 'c']]);
});
it('uses the file reader for a standalone document and checks cancellation before building it', async () => {
  const deps = dependencies(), controller = new AbortController();
  deps.read.mockImplementation(async () => { controller.abort(); return '{"name":"saved"}'; });
  await loadPartThumbnails([target('file')], null, { ...deps, signal: controller.signal });
  expect(deps.read).toHaveBeenCalledOnce(); expect(deps.render).not.toHaveBeenCalled();
});
