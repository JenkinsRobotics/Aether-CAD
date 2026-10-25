/** Exercise real Hybrid persistence and Drive navigation on Studio's disposable fixture. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,expect}=createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin=process.env.AETHER_TEST_ORIGIN,evidence=process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'8780');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],steps=[];page.on('pageerror',e=>errors.push(e.message));
page.on('response', async response => { if (response.status() >= 400 && response.url().includes('/api/')) await appendFile(join(evidence,'http-errors.jsonl'),JSON.stringify({url:response.url(),status:response.status(),body:await response.text()})+'\n'); });
const button=name=>page.getByRole('button',{name,exact:true});
const panel=page.getByRole('region',{name:'Files navigation',exact:true});
const api=(action,data)=>page.evaluate(async({action,data})=>{const r=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error(action+': '+await r.text());return r.json();},{action,data});
const step=async(name,run)=>{console.log('Begin '+name);await run();steps.push(name);await page.screenshot({path:join(evidence,steps.length+'-'+name+'.png')});console.log('Passed '+name);};
const create=async(menu,name)=>{
 await panel.getByRole('button',{name:'Create in this design',exact:true}).click();
 await page.getByRole('menuitem',{name:menu,exact:true}).click();
 await page.getByRole('dialog').getByRole('textbox').fill(name);
 await page.getByRole('dialog').getByRole('button',{name:'Create',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:60000});
 await expect(panel).toContainText(name,{timeout:60000});
};
let source,design,partId,drawingId;
try{
 await page.goto(origin+'/cad/');await page.locator('input[name="username"]').fill('editor');await page.locator('input[name="password"]').fill('account-test-password-2026');await button('Sign in').click();await expect(page.locator('input[name="password"]')).toHaveCount(0,{timeout:30000});await page.waitForLoadState('networkidle');
 const data={format:'aether-part',formatVersion:22,documentId:randomUUID(),name:'Bracket',units:'millimeter',features:[
  {id:'profile',name:'Rectangle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[-20,-10],[20,-10],[20,10],[-20,10]]}},
  {id:'extrude',name:'Extrude',type:'extrude',profileFeatureId:'profile',suppressed:false,operation:'new',distanceMillimeters:12},
 ]};
 source=await api('library/create',{app:'cad',kind:'file',scope:'personal',operation_id:randomUUID(),name:'Hybrid source.acpart',data_base64:Buffer.from(JSON.stringify(data)).toString('base64')});
 await page.goto(`${origin}/cad/index.html?document=${source.id}`);await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});await button('Files').click();
 await step('standalone-to-hybrid',async()=>{
  await expect(panel).toContainText('Standalone part');
  await panel.getByRole('button',{name:'Design actions',exact:true}).click();await page.getByRole('menuitem',{name:'Create Hybrid design from this Part…',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Machine');await page.getByRole('dialog').getByRole('button',{name:'Create',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:60000});await expect(panel).toContainText('Main Assembly');
  design=new URL(page.url()).searchParams.get('document');assert.notEqual(design,source.id);
  const result=await api('library/project_read',{app:'cad',id:design});partId=result.project.parts[0].id;
  assert.equal(result.project.parts[0].document.features.length,data.features.length);
  assert.equal((await api('library/read',{app:'cad',id:source.id})).revision,source.revision);
 });
 await step('internal-part-and-assembly',async()=>{
  await create('Create Part Studio…','Internal bracket');assert.equal(new URL(page.url()).searchParams.get('document'),design);
  await create('Create Assembly…','Internal mechanism');assert.equal(new URL(page.url()).searchParams.get('document'),design);
  const result=await api('library/project_read',{app:'cad',id:design});assert.equal(result.project.parts.length,2);assert.equal(result.project.assemblies.length,2);
  await panel.locator(`[data-document-tab-id="${partId}"] .aui-tab-browser-row`).click();await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:60000});
 });
 await step('embedded-drawing-edit-reopen',async()=>{
  await create('Create Drawing…','Manufacturing');assert.equal(new URL(page.url()).searchParams.get('document'),design);
  drawingId=new URL(page.url()).searchParams.get('drawing');assert.ok(drawingId);
  await button('Base view').click();await page.getByRole('dialog').getByRole('button',{name:'Add',exact:true}).click();
  await expect(page.locator('svg[data-sheet-id] [data-view-id]')).toHaveCount(1);
  assert.ok(await page.locator('svg[data-sheet-id] [data-primitive-id]').count() > 0);
  await button('Annotation').click();await page.locator('#drawing-note').fill('Contained in Machine');await page.getByRole('dialog').getByRole('button',{name:'Add',exact:true}).click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async()=>{const file=await api('library/read',{app:'cad',id:design});const p=await api('library/project_read',{app:'cad',id:design,revision:file.revision});return p.project.drawings[0].document.sheets[0].annotations.length;},{timeout:60000}).toBe(1);
  await page.reload();await expect(panel).toBeVisible({timeout:90000});await expect(panel).toContainText('Manufacturing');await expect(page.locator('svg[data-sheet-id]')).toBeVisible({timeout:60000});await expect(page.locator('svg[data-sheet-id]')).toContainText('Contained in Machine');
  await panel.locator(`[data-document-tab-id="${partId}"] .aui-tab-browser-row`).click();await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:60000});
  await panel.locator(`[data-document-tab-id="${drawingId}"] .aui-tab-browser-row`).click();await expect(page.locator('svg[data-sheet-id]')).toBeVisible({timeout:60000});await expect(page.locator('svg[data-sheet-id]')).toContainText('Contained in Machine');
 });
 await step('drive-location-and-design-scope',async()=>{
  await panel.getByRole('tab',{name:'Drive',exact:true}).click();await expect(panel.locator(`[data-drive-id="${design}"]`)).toBeVisible({timeout:30000});
  await expect(panel.locator(`[data-drive-id="${source.id}"]`)).toBeVisible();
  await panel.getByRole('button',{name:'Create in Drive',exact:true}).click();await page.getByRole('menuitem',{name:'New folder…',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Project files');await page.getByRole('dialog').getByRole('button',{name:'Create',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await panel.getByRole('button',{name:/Project files/}).first().click();await expect(panel).toContainText('This folder is empty.');
  await panel.getByRole('button',{name:'Back to My files',exact:true}).click();await expect(panel.locator(`[data-drive-id="${design}"]`)).toBeVisible();
  await page.screenshot({path:join(evidence,'drive-location.png')});
  await panel.getByRole('tab',{name:'This design',exact:true}).click();assert.equal(await panel.locator('[data-document-tab-id]').count(),5);
  await expect(panel.locator(`[data-document-tab-id="${source.id}"]`)).toHaveCount(0);
  await page.setViewportSize({width:1024,height:768});assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);
 });
 await expect(panel.locator('[data-icon-missing]')).toHaveCount(0);
 assert.deepEqual(errors,[]);
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});await writeFile(join(evidence,'failure-dom.txt'),await page.locator('body').innerText());throw error;}
finally{await writeFile(join(evidence,'results.json'),JSON.stringify({steps,errors,design},null,2));await browser.close();}
