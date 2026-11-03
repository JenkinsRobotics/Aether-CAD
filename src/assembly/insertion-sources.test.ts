import { it, expect, vi, afterEach } from 'vitest';
import { documentRequest } from '@aether/session/documents';
import { appendSolidPrimitive, defaultPrimitiveDimensions } from '../modeling/solid-primitives';
import { listInsertFiles, savedInsertCandidates, readInsertSource } from './insertion-sources';
vi.mock('@aether/session/documents', async importOriginal => ({ ...await importOriginal<object>(), documentRequest: vi.fn() }));
const request = vi.mocked(documentRequest);
const document = appendSolidPrimitive(null, 'box', defaultPrimitiveDimensions);
afterEach(() => vi.resetAllMocks());
it('lists supported saved designs once across accessible scopes', async () => {
  const file = { id: 'a', name: 'Saved.aethercad', revision: 3 };
  request.mockResolvedValue({ files: [file, { id: 'b', name: 'Part.aethercad', revision: 4 }, { id: 'c', name: 'Notes.txt' }] });
  expect(await listInsertFiles()).toEqual([{ id: 'b', name: 'Part.aethercad', revision: 4 }, file]);
  expect(request).toHaveBeenCalledWith('cad', 'list', { query: '.', view: 'personal' });
  expect(request).toHaveBeenCalledWith('cad', 'list', { query: '.', view: 'workspace' });
});
it('reads a Hybrid Part from exactly the selected saved revision and branch', async () => {
  request.mockResolvedValueOnce({ id: 'design', name: 'Machine.aethercad', revision: 7 })
    .mockResolvedValueOnce({ project: { parts: [{ id: 'p', name: 'Bracket', document }], assemblies: [{ id: 'a', name: 'Assembly' }] } });
  const result = await savedInsertCandidates('design', 7, 'branch-source');
  expect(result[0].source).toEqual({ kind: 'saved-part', fileId: 'design', revision: 7, partId: 'p', branch: 'branch-source' });
  expect(result[0].document).toEqual(document); expect(result[1].unavailable).toContain('Nested');
  expect(request.mock.calls.map(call => call[1])).toEqual(['read_revision', 'project_read']);
  expect(request.mock.calls[1][2]).toEqual({ id: 'design', revision: 7, branch: 'branch-source' });
});
it('reads the only Part Studio of a document without modifying either document', async () => {
  request.mockResolvedValueOnce({ id: 'part', name: 'Bracket.aethercad', revision: 4 })
    .mockResolvedValueOnce({ project: { parts: [{ id: 'part', name: document.name, document }], assemblies: [] } });
  expect(await readInsertSource({ kind: 'saved-part', fileId: 'part', revision: 4 })).toEqual({ name: document.name, document });
  expect(request).toHaveBeenCalledTimes(2);
});
it('refuses an inconsistent revision or an inaccessible source', async () => {
  request.mockResolvedValueOnce({ name: 'x.aethercad', revision: 8 });
  await expect(savedInsertCandidates('x', 7)).rejects.toThrow('revision changed');
  request.mockRejectedValueOnce(Error('Not allowed'));
  await expect(savedInsertCandidates('x', 7)).rejects.toThrow('Not allowed');
});
