import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readRecovery, recoveryKey } from '@aether/session/autosave';
import { readAetherCAD, tabArchive } from './document/aethercad-archive';
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
let dom: { window: Window & { close(): void } };
// The recovery key names the tab: document id, Part Studio id, branch, revision.
const key = recoveryKey('cad', 'operator', 'part:p1::');
let revision = 1;
/** The Part Studio tab as the server holds it; `project_edit save_part` replaces it. */
const partDocument = (features: unknown[]) => ({ format: 'aether-part', formatVersion: 3, documentId: 'p1', name: 'Part', units: 'millimeter', features });
let saved = partDocument([]);
const calls: { action: string; data: Record<string, unknown> }[] = [];
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
const stored = () => ({ id: 'part', name: 'Part.aethercad', revision, writable: true, data_base64: btoa('archive'),
  project: { kind: 'part', parts: [{ id: 'p1', name: 'Part', document: saved }], assemblies: [{ id: 'a', name: 'Assembly' }] } });
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); calls.length = 0; revision = 1; saved = partDocument([]);
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/cad/index.html?document=part' });
  for (const key of ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'Event', 'CustomEvent', 'File', 'FileReader'])
    vi.stubGlobal(key, (dom.window as unknown as Record<string, unknown>)[key]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/status') return new Response(JSON.stringify({ user: { id: 'operator' } }));
    const data = JSON.parse(String(init?.body)); const action = url.split('/').at(-1)!; calls.push({ action, data });
    if (action === 'save' || action === 'project_edit') {
      if (data.expected_revision !== revision) return new Response(JSON.stringify({ error: 'changed elsewhere' }), { status: 409 });
      if (action === 'project_edit') saved = data.document;
      else try { saved = readAetherCAD(bytesOf(data.data_base64)).graph.part_definitions[0].feature_document as typeof saved; } catch { /* an assembly archive keeps the Part Studio */ }
      revision++;
    }
    if (action === 'create') revision++;
    return new Response(JSON.stringify(stored()));
  }));
});
afterEach(() => { dom.window.close(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('captures a Part immediately and saves it into its document without the Save command', async () => {
  const host = await import('./host-library');
  let current = partDocument([]);
  host.configureAutosave(async () => {}, () => tabArchive(current, 'part'));
  await host.loadHostedFile(); host.markHostedClean();
  current = partDocument(['new sketch']); host.markHostedDirty();
  expect(readRecovery(key)).not.toBeNull(); expect(calls.filter(c => c.action === 'project_edit')).toHaveLength(0);
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await vi.advanceTimersByTimeAsync(1200);
  expect(saved).toEqual(current); expect(readRecovery(key)).toBeNull();
  expect(calls.find(c => c.action === 'project_edit')?.data).toMatchObject({ operation: 'save_part', part_id: 'p1' });
});

it('opens a pending recovered Part and preserves the base revision for conflict checks', async () => {
  const current = partDocument(['recovered']);
  sessionStorage.setItem(key, JSON.stringify({ text: JSON.stringify({ name: 'Part.aethercad', data: Array.from(tabArchive(current, 'part').bytes) }),
    base: { id: 'part', name: 'Part.aethercad', revision: 1, writable: true } }));
  revision = 2;
  const host = await import('./host-library');
  host.configureAutosave(async () => {}, () => tabArchive(current, 'part'));
  const file = (await host.loadHostedFile())!;
  const reading = new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(file); });
  await vi.runAllTimersAsync();
  const recovered = readAetherCAD(new Uint8Array(await reading));
  expect(recovered.kind).toBe('part');
  expect(recovered.graph.part_definitions[0].feature_document).toEqual(current); host.markHostedClean();
  await expect(host.flushAutosaveNow()).rejects.toMatchObject({status:409});
  expect(calls.filter(c => c.action === 'project_edit')).toHaveLength(0);
  expect(readRecovery<{ revision: number }>(key)?.base.revision).toBe(1);
});

it('saves an Assembly tab as the whole document through autosave', async () => {
  history.replaceState(null, '', '/cad/index.html?document=part&assembly=a');
  const host = await import('./host-library');
  await host.loadHostedFile(); host.markHostedClean();
  const capture = vi.fn(async () => { await host.saveHostedFile('Part.aethercad', new TextEncoder().encode('archive v2')); });
  host.configureAutosave(capture, () => null); host.markHostedDirty();
  expect(capture).toHaveBeenCalledTimes(1);
  await host.flushAutosaveNow();
  expect(calls.some(c => c.action === 'save' && c.data.id === 'part' && c.data.data_base64 === btoa('archive v2'))).toBe(true);
  expect(calls.some(c => c.action === 'create')).toBe(false);
});

it('retains an interrupted CAD draft and confirms an accepted save without repeating it', async () => {
  const host = await import('./host-library');
  let current = partDocument([]);
  host.configureAutosave(async () => {}, () => tabArchive(current, 'part'));
  await host.loadHostedFile(); host.markHostedClean();
  expect(calls.find(c => c.action === 'read')?.data).not.toHaveProperty('revision');
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  let writes = 0;
  fetcher.mockImplementation(async (...args) => {
    if (String(args[0]).endsWith('/project_edit')) {
      writes++;
      const payload = JSON.parse(String(args[1]?.body));
      expect(payload.operation_id).toEqual(expect.any(String));
      await original(...args); // Server accepted it; only the acknowledgement was lost.
      throw new TypeError('Reply lost after save');
    }
    return original(...args);
  });
  current = partDocument(['edited']); host.markHostedDirty();
  await expect(host.flushAutosaveNow()).rejects.toMatchObject({ retryable: false });
  expect(readRecovery(key)).not.toBeNull();
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(12_000);
  expect(writes).toBe(1);
  expect(readRecovery(key)).toBeNull();
  expect(calls.filter(c=>c.action==='read').length).toBeGreaterThan(1);
});

it('keeps a project branch while opening, adding items and navigating between Parts', async () => {
  const branch='branch-'+'a'.repeat(64);
  history.replaceState(null,'','/cad/index.html?document=project&branch='+branch);
  vi.stubGlobal('fetch',vi.fn(async(url:string, init?:RequestInit)=>{
    if(url==='/api/status')return new Response(JSON.stringify({user:{id:'operator'}}));
    const data=JSON.parse(String(init?.body)); const action=url.split('/').at(-1)!;
    calls.push({action,data});
    return new Response(JSON.stringify({id:'project',name:'Wheel.aethercad',revision:1,writable:true,branch_id:branch,data_base64:'e30=',project:{kind:'part',parts:[{id:'p',name:'Part',document:{format:'aether-part',documentId:'p',name:'Part',features:[]}}],assemblies:[]}}));
  }));
  const host=await import('./host-library');
  await host.loadHostedFile();host.markHostedClean();
  await host.editHostedProject('add_part','Bracket');
  expect(calls.filter(c=>c.action==='project_read'||c.action==='project_edit').every(c=>c.data.branch===branch)).toBe(true);
  expect(calls.find(c=>c.action==='project_edit')?.data.operation_id).toEqual(expect.any(String));
  expect(host.projectItemURL('p','part')).toContain('&branch='+branch);
});

it('refreshes project tabs from the matching canonical assembly without saving a second document',async()=>{
  history.replaceState(null,'','/cad/index.html?document=project&assembly=a');
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url==='/api/status')return new Response(JSON.stringify({user:{id:'operator'}}));
    return new Response(JSON.stringify({id:'project',name:'Assembly.aethercad',revision:1,writable:true,data_base64:'e30=',project:{id:'workspace',kind:'assembly',parts:[],assemblies:[{id:'a',name:'Assembly'}]}}));
  }));
  const host=await import('./host-library');await host.loadHostedFile();host.markHostedClean();
  const projection={workspace_id:'workspace',part_definitions:[{id:'p',name:'Template',feature_document:{features:[]},source:{kind:'authored',label:'Template',asset_ref:null}}],assemblies:[{id:'a',name:'Assembly'}]};
  host.syncHostedAssemblyProject(projection as any);
  expect(host.activeProject?.parts.map(p=>p.name)).toEqual(['Template']);
  expect(host.projectItemURL('p','part')).toContain('document=project&part=p');
  host.syncHostedAssemblyProject({...projection,workspace_id:'another',part_definitions:[]} as any);
  expect(host.activeProject?.parts).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.every(([url])=>!String(url).endsWith('/save'))).toBe(true);
});

it('initializes example tabs from the canonical assembly without a preliminary workspace', async () => {
  history.replaceState(null, '', '/cad/index.html?example=wrench&assembly=a');
  const host = await import('./host-library');
  const projection = {workspace_id: 'example-workspace', part_definitions: [{id:'p',name:'Native part',feature_document:{features:[{type:'sketch'}]},source:{kind:'authored',label:'Native part',asset_ref:null}}], assemblies:[{id:'a',name:'Selected assembly'}]};
  host.syncHostedAssemblyProject(projection as any);
  expect(host.activeProject?.parts[0].document).toEqual({features:[{type:'sketch'}]});
  expect(host.activeProject?.assemblies).toEqual([{id:'a',name:'Selected assembly'}]);
  expect(calls).toEqual([]);
});

it('resumes an expired-session draft after fresh verification of the same revision', async () => {
 const host=await import('./host-library');let current=partDocument([]);
 host.configureAutosave(async()=>{},()=>tabArchive(current,'part'));
 await host.loadHostedFile();host.markHostedClean();
 const fetcher=vi.mocked(fetch), original=fetcher.getMockImplementation()!;let expired=true;
 fetcher.mockImplementation(async(...args)=>String(args[0])==='/api/status'&&expired?new Response(JSON.stringify({user:null})):original(...args));
 current=partDocument(['latest']);host.markHostedDirty();
 await expect(host.flushAutosaveNow()).rejects.toMatchObject({status:401});
 expect(host.hostedSaveRecovery()!.state.backedUp).toBe(true);expired=false;
 await host.hostedSaveRecovery()!.retry();expect(saved).toEqual(current);expect(host.hostedSaveRecovery()!.state.phase).toBe('saved');
});
it('never grants a clean stale Part the newer revision before its next edit',async()=>{
 const host=await import('./host-library');let current=partDocument([]);
 host.configureAutosave(async()=>{},()=>tabArchive(current,'part'));
 await host.loadHostedFile();host.markHostedClean();revision=2;saved=partDocument(['remote']);
 await host.hostedSaveRecovery()!.check();current=partDocument(['old tab edit']);host.markHostedDirty();
 await expect(host.flushAutosaveNow()).rejects.toMatchObject({status:409});
 expect(saved).toEqual(partDocument(['remote']));expect(calls.filter(c=>c.action==='project_edit')).toHaveLength(0);
});
