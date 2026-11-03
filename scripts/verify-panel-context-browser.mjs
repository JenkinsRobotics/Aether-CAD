/** Right-click workflows against a disposable Studio host, never production documents. */
import assert from 'node:assert/strict';
import { verifyHistoryMenus } from './browser/history-menu-checks.mjs';
import { matchingRowMenus, menuSnapshot, nativeTextMenu } from './browser/panel-menu-checks.mjs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
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
const read = async id => tabDocumentOf((await request('library/read',{app:'cad',id})).data_base64);
const background = async locator => {
  const box = await locator.boundingBox(); assert.ok(box);
  await locator.click({button:'right',position:{x:Math.min(10,box.width/2),y:box.height-12}});
  await expect(page.getByRole('menu')).toBeVisible();
  await menuSnapshot(page);
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
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.part.json',import.meta.url),'utf8'));
  data.documentId=randomUUID(); data.name='Panel menus check';
  file=await request('library/create',{app:'cad',kind:'file',scope:'personal',operation_id:randomUUID(),name: 'Panel menus check.aethercad', data_base64: partDocumentBase64(data)});
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await row(/^Extrude/).waitFor({timeout:90000});
  await step('files-row-and-background-actions', async()=>{
    await button('Files').click();
    const fileRow = files.locator(`[data-document-tab-id="${file.id}"]`);
    await matchingRowMenus(page, fileRow, fileRow.getByRole('button',{name:/Options for/}));
    await background(files.locator('.aui-tab-browser-items'));
    await expect(item('Create Hybrid design from this Part…')).toBeVisible();
    await page.screenshot({path:join(evidence,'files-background-menu.png')});
    await page.getByRole('menuitemradio',{name:'Gallery view',exact:true}).click();
    await expect(files).toHaveAttribute('data-view','gallery');
    await files.getByRole('button',{name:'File view',exact:true}).click();
    await page.getByRole('menuitemradio',{name:'List view',exact:true}).click();
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
    await matchingRowMenus(page,row(/^Extrude/),row(/^Extrude/).getByRole('button',{name:/Options for/}));
    await nativeTextMenu(page, page.getByRole('searchbox',{name:'Filter Features',exact:true}));
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
    await matchingRowMenus(page,partsBackground.getByRole('treeitem'),partsBackground.getByRole('button',{name:/Options for/}));
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
  await step('version-branches-merge-and-collapse', async()=>{
    await verifyHistoryMenus(page,expect);
    await button('Files').click();
  });
  await step('hybrid-folders-and-component-shortcuts', async()=>{
    if (!await files.isVisible()) await button('Files').click();
    await files.getByRole('button',{name:'Design actions',exact:true}).click();
    await item('Create Hybrid design from this Part…').click();
    await page.getByRole('dialog').getByRole('textbox').fill('Panel menu project');
    await page.getByRole('dialog').getByRole('button',{name:'Create',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:60000});
    await expect(files).toContainText('Main Assembly');
    const design = new URL(page.url()).searchParams.get('document');
    const project = (await request('library/project_read',{app:'cad',id:design})).project;
    const partID = project.parts[0].id, assemblyID = project.assemblies[0].id;
    await background(files.locator('.aui-tab-browser-items')); await item('New folder…').click();
    await page.getByRole('textbox',{name:'Folder name',exact:true}).fill('Hardware');
    await page.getByRole('dialog').getByRole('button',{name:'Create folder',exact:true}).click();
    const folder = files.locator('[data-tab-folder]').filter({hasText:'Hardware'});
    await matchingRowMenus(page,folder,folder.getByRole('button',{name:'Options for Hardware',exact:true}));
    await folder.locator('.aui-tab-browser-row').focus(); await page.keyboard.press('F2');
    await page.getByRole('textbox',{name:'Folder name',exact:true}).fill('Components');
    await page.getByRole('dialog').getByRole('button',{name:'Rename',exact:true}).click();
    await files.locator('[data-tab-folder]').filter({hasText:'Components'}).locator('.aui-tab-browser-row').focus();
    await page.keyboard.press('Backspace'); await expect(files.locator('[data-tab-folder]')).toHaveCount(0);
    await files.locator(`[data-document-tab-id="${assemblyID}"] .aui-tab-browser-row`).click();
    const insertControl = page.locator('button.aui-icon-button[aria-label="Insert Part"]');
    await expect(insertControl).toBeEnabled({timeout:90000});
    await insertControl.click({timeout:60000});
    const insert = page.getByRole('dialog',{name:'Insert parts',exact:true});
    await insert.getByRole('button',{name:project.parts[0].name+' Part Studio',exact:true}).click();
    await insert.getByRole('button',{name:'Insert Part',exact:true}).click();
    await expect(insert).toHaveCount(0,{timeout:90000});
    const component = partsBackground.getByRole('treeitem').first();
    await expect(component).toBeVisible();
    await matchingRowMenus(page,component,component.getByRole('button',{name:/Options for/}));
    await background(partsBackground);
    await expect(item('Insert component…')).toBeVisible(); await page.keyboard.press('Escape');
    await component.click(); await component.focus(); await page.keyboard.press('F2');
    const properties = page.getByRole('dialog',{name:'Component properties',exact:true});
    await properties.getByLabel('Name',{exact:true}).fill('Checked component');
    await properties.getByRole('button',{name:'Apply',exact:true}).click();
    await expect(properties).toHaveCount(0,{timeout:60000});
    await expect(partsBackground).toContainText('Checked component');
    const renamed = partsBackground.getByRole('treeitem').filter({hasText:'Checked component'});
    await renamed.click(); await renamed.focus(); await page.keyboard.press('Delete');
    await expect(partsBackground.getByRole('treeitem')).toHaveCount(0,{timeout:60000});
    // Keep the authored Part and its geometry after removing only the occurrence.
    await files.locator(`[data-document-tab-id="${partID}"] .aui-tab-browser-row`).click();
    await row(/^Extrude/).waitFor({timeout:90000});
  });
  await step('drive-menus-and-both-themes', async()=>{
    for (const app of ['cad','map']) {
      if (app === 'map') {
        await page.goto(origin+'/map/index.html?new=show');
        await button('Files').click({timeout:60000});
      }
      const panel = page.getByRole('region',{name:'Files navigation',exact:true});
      await panel.getByRole('radio',{name:'Drive',exact:true}).click();
      const drive = panel.getByRole('region',{name:'Drive files',exact:true});
      const driveRow = drive.locator('[data-drive-id]').first();
      await expect(driveRow).toBeVisible({timeout:30000});
      await matchingRowMenus(page,driveRow,driveRow.getByRole('button',{name:/Options for/}));
      for (const theme of ['light','dark']) {
        await page.evaluate(theme=>{
          document.documentElement.classList.toggle('aether-light-theme',theme==='light');
          document.documentElement.dataset.aetherTheme=theme;
        },theme);
        await background(drive.locator('.aui-tab-browser-items'));
        await expect(item('New folder…')).toBeVisible();
        await page.screenshot({path:join(evidence,`${app}-${theme}-drive-context.png`)});
        await item('Refresh').click();
        await expect(driveRow).toBeVisible();
      }
      await expect(drive.getByRole('button',{name:'Refresh Drive',exact:true})).toHaveCount(0);
      await background(drive.locator('.aui-tab-browser-items')); await item('New folder…').click();
      await expect(page.getByRole('dialog',{name:'New Drive folder',exact:true})).toBeVisible();
      await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    }
  });
  assert.deepEqual(errors,[]);
} catch(error) {
  console.error('Browser flow failed:',error);
  await page.screenshot({path:join(evidence,'failure.png'),timeout:10000}).catch(()=>{});
  await writeFile(join(evidence,'failure-dom.txt'),await page.locator('body').innerText());throw error;
} finally {
  await writeFile(join(evidence,'results.json'),JSON.stringify({steps,errors},null,2));await browser.close();
}
