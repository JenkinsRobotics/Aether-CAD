/** Right-click workflows against a disposable Studio host, never production documents. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive:true });
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(15000);
const errors = [], steps = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button',{name,exact:true});
const item = name => page.getByRole('menuitem',{name,exact:true});
const row = name => page.getByRole('treeitem',{name}).first();
const files = page.locator('.aui-tab-browser');
const featureBackground = page.locator('.cad-items-tree .aui-tree-panel-content');
const partsBackground = page.locator('.cad-parts-list .aui-tree-panel-content');
const request = (action,data) => page.evaluate(async ({action,data}) => {
  const response = await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  if(!response.ok)throw Error(await response.text());return response.json();
},{action,data});
const read = async id => JSON.parse(Buffer.from((await request('library/read',{app:'cad',id})).data_base64,'base64'));
const background = async locator => {
  const box = await locator.boundingBox(); assert.ok(box);
  await locator.click({button:'right',position:{x:Math.min(10,box.width/2),y:box.height-12}});
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem',{name:/Undo sketch|Redo sketch|Aether CAD settings/})).toHaveCount(0);
};
const step = async (name, action) => {
  console.log('Begin '+name); await action(); steps.push(name);
  await page.screenshot({path:join(evidence,`${steps.length}-${name}.png`)});console.log('Passed '+name);
};
let file;
try {
  await page.goto(origin+'/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0,{timeout:30000});
  await page.waitForLoadState('networkidle');
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.acpart',import.meta.url),'utf8'));
  data.documentId=randomUUID(); data.name='Panel menus check';
  file=await request('library/create',{app:'cad',kind:'file',scope:'personal',operation_id:randomUUID(),name:'Panel menus check.acpart',data_base64:Buffer.from(JSON.stringify(data)).toString('base64')});
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await row(/^Extrude/).waitFor({timeout:90000});
  await step('files-background-and-folder-actions', async()=>{
    await button('Files').click();
    await background(files.locator('.aui-tab-browser-items'));
    await page.screenshot({path:join(evidence,'files-background-menu.png')});
    await item('New folder…').click();
    await page.getByRole('textbox',{name:'Folder name',exact:true}).fill('Context folder');
    await page.getByRole('dialog',{name:'New folder',exact:true}).getByRole('button',{name:'Create folder',exact:true}).click();
    await files.locator(`[data-document-tab-id="${file.id}"]`).click({button:'right'});
    await item('Move to folder').click();
    await page.getByRole('menuitemradio',{name:'Context folder',exact:true}).click();
    await files.locator('[data-tab-folder]').filter({hasText:'Context folder'}).click({button:'right'});
    await item('Rename folder…').click();
    await page.getByRole('textbox',{name:'Folder name',exact:true}).fill('Checked folder');
    await page.getByRole('dialog',{name:'Rename folder',exact:true}).getByRole('button',{name:'Rename',exact:true}).click();
    await files.locator('[data-tab-folder]').filter({hasText:'Checked folder'}).click({button:'right'});
    await item('Ungroup folder').click();
    await expect(files.locator(`[data-document-tab-id="${file.id}"]`)).toBeVisible();
    await background(files.locator('.aui-tab-browser-items'));
    await page.getByRole('menuitemradio',{name:'Gallery view',exact:true}).click();
    await expect(files).toHaveAttribute('data-view','gallery');
  });
  await step('feature-background-and-selection-actions', async()=>{
    await background(featureBackground);
    await expect(item('New sketch…')).toBeVisible();
    await page.screenshot({path:join(evidence,'features-background-menu.png')});
    await item('Solid features').click(); await expect(item('Extrude…')).toBeVisible();
    console.log('Feature creation submenu verified');
    await page.keyboard.press('Escape');
    await background(featureBackground);
    page.once('dialog',dialog=>dialog.accept('Feature group'));
    await item('New folder').click();
    await row(/^Feature group/).waitFor();
    await row(/^Extrude/).click({button:'right'});
    await expect(item('Edit…')).toBeVisible();
    await expect(item('Dynamic suppression…')).toHaveCount(0);
    await expect(item('Undo sketch')).toHaveCount(0);
    await item('Suppress').click();
    await expect.poll(async()=> (await read(file.id)).features.find(f=>f.id==='pad').suppressed,{timeout:30000}).toBe(true);
    await row(/^Extrude/).click({button:'right'}); await item('Unsuppress').click();
    await expect.poll(async()=> (await read(file.id)).features.find(f=>f.id==='pad').suppressed,{timeout:30000}).toBe(false);
    await button('Undo').click();
    await expect.poll(async()=> (await read(file.id)).features.find(f=>f.id==='pad').suppressed,{timeout:30000}).toBe(true);
    await button('Redo').click();
    await expect.poll(async()=> (await read(file.id)).features.find(f=>f.id==='pad').suppressed,{timeout:30000}).toBe(false);
  });
  await step('parts-visibility-persists-and-can-be-restored', async()=>{
    await expect(partsBackground.getByRole('treeitem')).toHaveCount(1);
    await background(partsBackground); await item('Hide all parts').click();
    const hidden = async()=>Object.values((await read(file.id)).bodyProperties??{}).some(body=>body.visible===false);
    await expect.poll(hidden,{timeout:30000}).toBe(true);
    await page.reload(); await row(/^Extrude/).waitFor({timeout:90000});
    await expect(partsBackground.locator('.aui-tree-row--dimmed')).toHaveCount(1);
    await background(partsBackground); await item('Show all parts').click();
    await expect.poll(hidden,{timeout:30000}).toBe(false);
    await partsBackground.getByRole('treeitem').click({button:'right'});
    await expect(item('Hide')).toBeVisible(); await expect(item('Isolate part')).toBeVisible();
    await item('Zoom to part').click();
  });
  await step('view-and-edit-commands-use-existing-controls', async()=>{
    await background(featureBackground); await item('Camera views').click(); await item('Front').click();
    await background(featureBackground); await item('Display style').click();
    await page.getByRole('menuitemradio',{name:'Wireframe',exact:true}).click();
    await background(featureBackground); await item('Display style').click();
    await page.getByRole('menuitemradio',{name:'Shaded with edges',exact:true}).click();
    await row(/^Extrude/).click({button:'right'}); await item('Edit…').click();
    await expect(page.locator('.cad-feature-dialog')).toBeVisible();
    await page.locator('.cad-feature-dialog [data-feature-action="discard"]').click();
    await expect(page.locator('.cad-feature-dialog')).toHaveCount(0);
  });
  assert.deepEqual(errors,[]);
} catch(error) {
  console.error('Browser flow failed:',error);
  await page.screenshot({path:join(evidence,'failure.png'),timeout:10000}).catch(()=>{});
  await writeFile(join(evidence,'failure-dom.txt'),await page.locator('body').innerText());throw error;
} finally {
  await writeFile(join(evidence,'results.json'),JSON.stringify({steps,errors},null,2));await browser.close();
}
