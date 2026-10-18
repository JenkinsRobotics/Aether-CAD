import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readRecovery, recoveryKey } from '@aether/session/autosave';
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
let dom: { window: Window & { close(): void } };
const key = recoveryKey('cad', 'operator', 'part:::');
let revision = 1;
let text = '{"name":"Part"}';
const calls: { action: string; data: Record<string, unknown> }[] = [];
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); calls.length = 0; revision = 1;
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/cad/index.html?document=part' });
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'Event', 'CustomEvent', 'File', 'FileReader'])
    vi.stubGlobal(key, (dom.window as unknown as Record<string, unknown>)[key]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/status') return new Response(JSON.stringify({ user: { id: 'operator' } }));
    const data = JSON.parse(String(init?.body)); const action = url.split('/').at(-1)!; calls.push({ action, data });
    if (action === 'save' || action === 'create') {
      if (action === 'save' && data.expected_revision !== revision) return new Response(JSON.stringify({ error: 'changed elsewhere' }), { status: 409 });
      text = atob(data.data_base64); revision++;
    }
    return new Response(JSON.stringify({ id: 'part', name: 'Part.acpart', revision, writable: true, data_base64: btoa(text) }));
  }));
});
afterEach(() => { dom.window.close(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('captures a Part immediately and saves it without the Save command', async () => {
  const host = await import('./host-library');
  let current = '{"name":"Part","features":[]}';
  host.configureAutosave(async () => {}, () => ({ name: 'Part.acpart', bytes: new TextEncoder().encode(current) }));
  await host.loadHostedFile(); host.markHostedClean();
  current = '{"name":"Part","features":["new sketch"]}'; host.markHostedDirty();
  expect(readRecovery(key)).not.toBeNull(); expect(calls.filter(c => c.action === 'save')).toHaveLength(0);
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
  await vi.advanceTimersByTimeAsync(1200);
  expect(text).toBe(current); expect(readRecovery(key)).toBeNull();
});

it('opens a pending recovered Part and preserves the base revision for conflict checks', async () => {
  const current = '{"name":"Recovered","features":[]}';
  sessionStorage.setItem(key, JSON.stringify({ text: JSON.stringify({ name: 'Part.acpart', data: Array.from(new TextEncoder().encode(current)) }),
    base: { id: 'part', name: 'Part.acpart', revision: 1, writable: true } }));
  revision = 2;
  const host = await import('./host-library');
  host.configureAutosave(async () => {}, () => ({ name: 'Part.acpart', bytes: new TextEncoder().encode(current) }));
  const file = (await host.loadHostedFile())!;
  const reading = new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(file); });
  await vi.runAllTimersAsync();
  const recovered = await reading;
  expect(recovered).toBe(current); host.markHostedClean();
  await expect(host.flushAutosaveNow()).rejects.toThrow('changed elsewhere');
  expect(calls.filter(c => c.action === 'save')).toHaveLength(0);
  expect(readRecovery<{ revision: number }>(key)?.base.revision).toBe(1);
});

it('requests an Assembly archive immediately and sends it through autosave', async () => {
  const host = await import('./host-library');
  await host.loadHostedFile(); host.markHostedClean();
  const capture = vi.fn(async () => { await host.saveHostedFile('Assembly.acasm', new TextEncoder().encode('archive')); });
  host.configureAutosave(capture, () => null); host.markHostedDirty();
  expect(capture).toHaveBeenCalledTimes(1);
  await host.flushAutosaveNow();
  expect(calls.some(c => c.action === 'create' && c.data.name === 'Assembly.acasm')).toBe(true);
});

it('sends mutation IDs and retains a CAD draft when a save reply is lost', async () => {
  const host = await import('./host-library');
  let current = '{"name":"Part"}';
  host.configureAutosave(async () => {}, () => ({ name: 'Part.acpart', bytes: new TextEncoder().encode(current) }));
  await host.loadHostedFile(); host.markHostedClean();
  expect(calls.find(c => c.action === 'read')?.data).not.toHaveProperty('revision');
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  let writes = 0;
  fetcher.mockImplementation(async (...args) => {
    if (String(args[0]).endsWith('/save')) {
      writes++;
      const payload = JSON.parse(String(args[1]?.body));
      expect(payload.operation_id).toEqual(expect.any(String));
      throw new TypeError('Reply lost after save');
    }
    return original(...args);
  });
  current = '{"name":"Part","features":["edited"]}'; host.markHostedDirty();
  await expect(host.flushAutosaveNow()).rejects.toMatchObject({ retryable: false });
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(12_000);
  expect(writes).toBe(1);
  expect(readRecovery(key)).not.toBeNull();
});

it('keeps a project branch while opening, adding items and navigating between Parts', async () => {
  const branch='branch-'+'a'.repeat(64);
  history.replaceState(null,'','/cad/index.html?document=project&branch='+branch);
  vi.stubGlobal('fetch',vi.fn(async(url:string, init?:RequestInit)=>{
    if(url==='/api/status')return new Response(JSON.stringify({user:{id:'operator'}}));
    const data=JSON.parse(String(init?.body)); const action=url.split('/').at(-1)!;
    calls.push({action,data});
    return new Response(JSON.stringify({id:'project',name:'Wheel.acad',revision:1,writable:true,branch_id:branch,data_base64:'e30=',project:{parts:[{id:'p',name:'Part',document:{format:'aether-part',features:[]}}],assemblies:[]}}));
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
    return new Response(JSON.stringify({id:'project',name:'Assembly.acasm',revision:1,writable:true,data_base64:'e30=',project:{id:'workspace',parts:[],assemblies:[{id:'a',name:'Assembly'}]}}));
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
