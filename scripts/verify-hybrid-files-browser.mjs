/** Exercise real Hybrid persistence and Drive navigation on Studio's disposable fixture. */
import assert from 'node:assert/strict';
import { verifyPanelPresentation } from './browser/panel-presentation.mjs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
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
 source=await api('library/create',{app:'cad',kind:'file',scope:'personal',operation_id:randomUUID(),name: 'Hybrid source.aethercad', data_base64: partDocumentBase64(data)});
 await page.goto(`${origin}/cad/index.html?document=${source.id}`);await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});await button('Files').click();
 await step('agent-composer-controls',async()=>{
  // A deterministic provider fixture exercises the composer without using a paid account.
  let sent;
  await page.route('**/api/agent/*',async route=>{
   const action=new URL(route.request().url()).pathname.split('/').at(-1),data=route.request().postDataJSON();
   let result={id:'fixture-chat',state:'completed',text:'Fixture response'};
   if(action==='catalog')result={plugins:[{id:'fixture',name:'Fixture provider',installed:true,enabled:true,runtimeReady:true,account:{connected:true},capabilities:{chat:true}}]};
   if(action==='models')result={id:'fixture-models',state:'running'};
   if(action==='job'&&data.id==='fixture-models')result={id:'fixture-models',state:'completed',models:[{id:'fixture-model',name:'Fixture model'}]};
   if(action==='chat')sent=data;
   await route.fulfill({json:result});
  });
  await page.reload();await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});
  await button('AI advisor').click();const chat=page.getByRole('region',{name:'Aether Agent',exact:true});
  await expect(button('Choose model: Account default')).toBeVisible();
  await expect(chat).not.toContainText('· Connected');
  await button('Choose model: Account default').click();await page.getByRole('menuitemradio',{name:'Fixture model',exact:true}).click();
  await button('Chat mode: Agent').click();await page.getByRole('menuitemradio',{name:'Plan',exact:true}).click();
  await chat.getByRole('textbox').fill('Inspect this bracket and plan a change.');await button('Send').click();
  await expect.poll(()=>sent?.model).toBe('fixture-model');assert.ok(sent.context.includes('Chat mode: plan'));
  assert.ok(sent.tools.some(tool=>tool.name==='aether_cad_inspect'));assert.ok(!sent.tools.some(tool=>tool.name==='aether_cad_extrude'));
  await expect(chat.getByRole('log')).toContainText('Fixture response');
  await button('Chat context').click();await expect(page.getByRole('dialog')).toContainText('Bracket');await expect(page.getByRole('dialog')).toContainText('2 messages');await button('Done').click();
  await button('Choose model: Fixture model').click();await page.getByRole('menuitem',{name:'Add / manage connections…',exact:true}).click();await expect(page.getByRole('dialog',{name:'Agent connections'})).toBeVisible();await button('Done').click();
  await page.setViewportSize({width:1024,height:768});
  assert.equal(await chat.locator('.aui-agent-settings').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await expect(chat.locator('[data-icon-missing]')).toHaveCount(0);
  await page.screenshot({path:join(evidence,'agent-composer.png')});
  await page.setViewportSize({width:1440,height:1000});await button('Files').click();await page.unroute('**/api/agent/*');
 });
 await step('shared-panel-tabs',async()=>{
  const measure=group=>group.evaluate(el=>{const b=el.querySelector('[aria-checked=true]'),s=getComputedStyle(el),bs=getComputedStyle(b);return {width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,radius:s.borderRadius,fill:bs.backgroundColor,border:bs.borderColor,buttonHeight:b.getBoundingClientRect().height};});
  const files=await measure(panel.getByRole('radiogroup',{name:'Files view'}));
  await page.getByRole('toolbar',{name:'Aux toolbar'}).getByRole('button',{name:'Comments',exact:true}).click();
  const comments=await measure(page.getByRole('radiogroup',{name:'Review tabs'}));
  assert.deepEqual(files,comments);
  await page.screenshot({path:join(evidence,'comments-tabs.png')});
  await button('Files').click();
  await panel.getByRole('radio',{name:'This design',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('radio',{name:'Drive',exact:true})).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('ArrowLeft');await expect(panel.getByRole('radio',{name:'This design',exact:true})).toHaveAttribute('aria-checked','true');
 });
 await step('panel-themes-and-notifications',()=>verifyPanelPresentation(page,evidence));
 await step('document-holds-part-and-assembly',async()=>{
  // One document type: the saved Part Studio and its Main Assembly are tabs of the same document.
  await expect(panel).toContainText('Part Studio');await expect(panel).toContainText('Main Assembly');
  design=source.id;
  const result=await api('library/project_read',{app:'cad',id:design});partId=result.project.parts[0].id;
  assert.equal(result.project.parts[0].document.features.length,data.features.length);
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
  await panel.getByRole('radio',{name:'Drive',exact:true}).click();await expect(panel.locator(`[data-drive-id="${design}"]`)).toBeVisible({timeout:30000});
  await expect(panel.locator(`[data-drive-id="${source.id}"]`)).toBeVisible();
  await panel.getByRole('button',{name:'Create in Drive',exact:true}).click();await page.getByRole('menuitem',{name:'New folder…',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Project files');await page.getByRole('dialog').getByRole('button',{name:'Create',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await panel.getByRole('button',{name:/Project files/}).first().click();await expect(panel).toContainText('This folder is empty.');
  await panel.getByRole('button',{name:'Back to My files',exact:true}).click();await expect(panel.locator(`[data-drive-id="${design}"]`)).toBeVisible();
  await page.screenshot({path:join(evidence,'drive-location.png')});
  await panel.getByRole('radio',{name:'This design',exact:true}).click();assert.equal(await panel.locator('[data-document-tab-id]').count(),5);
  await expect(panel.locator(`[data-document-tab-id="${source.id}"]`)).toHaveCount(0);
  await page.setViewportSize({width:1024,height:768});assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);
 });
 await expect(panel.locator('[data-icon-missing]')).toHaveCount(0);
 assert.deepEqual(errors,[]);
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});await writeFile(join(evidence,'failure-dom.txt'),await page.locator('body').innerText());throw error;}
finally{await writeFile(join(evidence,'results.json'),JSON.stringify({steps,errors,design},null,2));await browser.close();}
