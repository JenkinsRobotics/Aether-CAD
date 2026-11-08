import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { partDocumentBase64 } from './browser/document-fixture.mjs';

const { _electron, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const profile = await mkdtemp(tmpdir() + '/aether-offline-');
const evidence = resolve('build/desktop-smoke');
await mkdir(evidence, { recursive: true });
const app = await _electron.launch({ executablePath: process.env.AETHER_DESKTOP_EXECUTABLE || process.env.AETHER_DESKTOP_DEV_EXECUTABLE || resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: process.env.AETHER_DESKTOP_EXECUTABLE ? [] : ['desktop'], env: { ...process.env, AETHER_DESKTOP_TEST_PROFILE: profile } });
const errors = [];
let page;
try {
  await app.context().route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort());
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible({timeout:60000});
  const origin = new URL(page.url()).origin;
  const graphicsAvailable = await page.evaluate(async () => {
    try { if (await navigator.gpu?.requestAdapter()) return true; } catch {}
    const gl = document.createElement('canvas').getContext('webgl2');
    const available = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return available;
  });
  const noGPUQualification = !graphicsAvailable && process.env.AETHER_DESKTOP_ALLOW_NO_GPU === '1';
  if (!graphicsAvailable && !noGPUQualification) throw Error('No usable GPU: viewport qualification requires WebGPU or WebGL2.');
  // Do not touch the user's files or native file dialog. The browser's real
  // filesystem handles and IndexedDB exercise the local storage adapter.
  await page.evaluate(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); });
  await page.getByRole('button', { name: 'Choose local folder', exact: true }).click();
  const doc = { format:'aether-part', formatVersion:29, documentId:'desktop-test-part', name:'Offline fixture', units:'millimeter', features:[
    {id:'s',type:'profile',name:'Sketch 1',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',id:'outline',start:[-10,-10],segments:[[10,-10],[10,10],[-10,10],[-10,-10]].map((end,i)=>({id:`edge-${i}`,type:'line',end}))}]}},
    {id:'pad',type:'extrude',name:'Extrude 1',profileFeatureId:'s',operation:'new',distanceMillimeters:10,suppressed:false},
  ]};
  const checks = await page.evaluate(async ({ encoded }) => {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('Offline fixture.aethercad', { create:true });
    const writer = await file.createWritable(); await writer.write(Uint8Array.from(atob(encoded), c=>c.charCodeAt(0))); await writer.close();
    const call = async (route, body) => { const r = await fetch('/api/cad/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(!r.ok)throw Error(await r.text());return r.json(); };
    const engine = await call('engine',{});
    const created = await call('project-create',{name:'Offline assembly',packaging:'assembly',operation_id:'desktop-test'});
    const read = await call('project-read',{data_base64:created.data_base64});
    return {engine:engine.engine,assembly:read.project.assemblies.length,picker:typeof showDirectoryPicker};
  }, { encoded:partDocumentBase64(doc) });
  assert.equal(checks.engine,'Aether'); assert.equal(checks.assembly,1);
  await page.goto(origin+'/cad/index.html?storage=local&document=Offline%20fixture.aethercad');
  const feature = page.getByRole('treeitem', {name:/Extrude 1/}).first();
  await expect(feature).toBeVisible({timeout:60000});
  await feature.dblclick();
  const dialog = page.locator('.cad-feature-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-feature-action="accept"]')).toBeEnabled({timeout:60000});
  await page.screenshot({path:resolve(evidence,'editable-extrude.png')});
  await dialog.getByLabel('Distance (mm)', {exact:true}).fill('15');
  await dialog.getByLabel('Distance (mm)', {exact:true}).press('Tab');
  await expect(dialog.locator('[data-feature-action="accept"]')).toBeEnabled({timeout:60000});
  await dialog.locator('[data-feature-action="accept"]').click();
  await expect.poll(async () => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle('Offline fixture.aethercad')).getFile();
    return (await file.text()).includes('"distanceMillimeters":15');
  }), {timeout:30000}).toBe(true);
  await page.reload();
  await expect(page.getByRole('treeitem',{name:/Extrude 1/}).first()).toBeVisible({timeout:60000});
  await page.getByRole('treeitem',{name:/Extrude 1/}).first().dblclick();
  await expect(page.locator('.cad-feature-dialog').getByLabel('Distance (mm)', {exact:true})).toHaveValue('15.000');
  await page.locator('.cad-feature-dialog [data-feature-action="discard"]').click();
  await page.getByRole('button', {name:/Units and precision/}).click();
  await expect(page.locator('#unit-length')).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('#unit-length')).not.toBeVisible({timeout:60000});
  await expect(page.getByRole('treeitem',{name:/Extrude 1/}).first()).toBeVisible({timeout:60000});
  assert.equal(await page.evaluate(() => { const child=window.open('about:blank','_blank');const opened=!!child;child?.close();return opened; }),true);
  const example = await page.evaluate(async () => {
    const catalog=await (await fetch('./examples/catalog.json')).json();
    const entry=catalog.find(item=>item.id==='piping');
    const bytes=new Uint8Array(await (await fetch('./examples/'+entry.file)).arrayBuffer());
    let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);
    const response=await fetch('/api/cad/project-read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_base64:btoa(raw)})});
    if(!response.ok)throw Error(await response.text());
    const {project}=await response.json();
    const part=project.parts.find(part=>part.document?.features?.some(feature=>feature.type==='sweep'));
    if(!part)throw Error('The bundled pipe example must contain a native Sweep.');
    return {id:entry.id,part:part.id,feature:part.document.features.find(feature=>feature.type==='sweep').name};
  });
  await page.goto(origin+'/cad/index.html?editor=1&example='+example.id+'&part='+encodeURIComponent(example.part));
  await expect(page.getByRole('treeitem',{name:example.feature}).first()).toBeVisible({timeout:60000});
  // A VM without either graphics API cannot qualify the viewport. Only its
  // known Three fallback-context failure is expected; every other error fails.
  const expectedGraphicsErrors = noGPUQualification ? errors.filter(error => error.includes("Cannot read properties of null (reading 'getSupportedExtensions')")) : [];
  assert.deepEqual(errors.filter(error => !expectedGraphicsErrors.includes(error)),[]);
  if (noGPUQualification) console.log('NO GPU: viewport rendering NOT qualified; document and modeling checks only.');
  await writeFile(resolve(evidence,'results.json'),JSON.stringify({checks,example,errors,profile,graphicsAvailable,viewportQualified:graphicsAvailable,nativeFileDialogTested:false},null,2));
  console.log('Offline home, engine, assembly creation, editable Part reopen and bundled Sweep example passed.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({path:resolve(evidence,'failure.png')});
    await writeFile(resolve(evidence,'failure.json'),JSON.stringify({error:String(error),errors,url:page.url(),body:await page.locator('body').innerText()},null,2));
  }
  throw error;
} finally { await app.close(); }
