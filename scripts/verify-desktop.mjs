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
const app = await _electron.launch({ executablePath: process.env.AETHER_DESKTOP_EXECUTABLE || resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: process.env.AETHER_DESKTOP_EXECUTABLE ? [] : ['desktop'], env: { ...process.env, AETHER_DESKTOP_TEST_PROFILE: profile } });
const errors = [];
try {
  await app.context().route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort());
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
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
  await page.goto(origin+'/index.html?storage=local&document=Offline%20fixture.aethercad');
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
  assert.deepEqual(errors,[]);
  await writeFile(resolve(evidence,'results.json'),JSON.stringify({checks,errors,profile,nativeFileDialogTested:false},null,2));
  console.log('Offline home, engine, assembly creation and editable Part reopen passed.');
} finally { await app.close(); }
