import { beforeEach, expect, it, vi } from 'vitest';
import { localProjectRequest, cadDocumentRequest } from './local-project';
import { localDocumentRequest } from '@aether/session/local-documents';
vi.mock('@aether/session/local-documents', () => ({ localDocumentRequest: vi.fn() }));
vi.mock('@aether/session/home/runtime', () => ({isLocalDocument:()=>true}));
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
it('refuses an edit based on an older file revision before computing', async () => {
  vi.mocked(localDocumentRequest).mockResolvedValue({ id:'file', revision:2, data_base64:'archive' });
  await expect(localProjectRequest('project_edit', {id:'file',expected_revision:1})).rejects.toThrow('changed');
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps the read fingerprint when saving the edited container', async () => {
  vi.mocked(localDocumentRequest).mockResolvedValueOnce({id:'file',revision:2,data_base64:'archive'}).mockResolvedValueOnce({id:'file',revision:3});
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({project:{parts:[]},data_base64:'edited'})));
  await localProjectRequest('project_edit', {id:'file',expected_revision:2,operation:'save_part'});
  expect(localDocumentRequest).toHaveBeenLastCalledWith('cad','save',{id:'file',expected_revision:2,data_base64:'edited'});
});
it('reads local document settings from the bundled codec', async () => {
  vi.mocked(localDocumentRequest).mockResolvedValue({id:'file',revision:2,data_base64:'archive'});
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({settings:{units:{}},items:[]})));
  expect(await cadDocumentRequest('cad','cad_metadata',{id:'file'})).toMatchObject({id:'file',revision:2,settings:{units:{}},updates:[]});
  expect(fetch).toHaveBeenCalledWith('/api/cad/settings-read', expect.anything());
});

it('coalesces simultaneous metadata reads so panels cannot starve document loading', async () => {
  vi.mocked(localDocumentRequest).mockResolvedValue({id:'file',revision:2,data_base64:'archive'});
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({settings:{units:{}},items:[]})));
  const results = await Promise.all(Array.from({length:6},()=>cadDocumentRequest('cad','cad_metadata',{id:'file'})));
  expect(results).toHaveLength(6);
  expect(fetch).toHaveBeenCalledTimes(1);
});
