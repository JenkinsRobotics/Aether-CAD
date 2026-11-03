/** Part → Assembly acceptance, using real controls and saved files on a disposable host. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin=process.env.AETHER_TEST_ORIGIN,evidence=process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'8780');await mkdir(evidence,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),steps=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const button=name=>page.getByRole('button',{name,exact:true});
const files=page.getByRole('region',{name:'Files navigation',exact:true});
const components=()=>page.locator('.cad-parts-panel');
const dialog=name=>page.getByRole('dialog',{name,exact:true});
const api=(action,data)=>page.evaluate(async({action,data})=>{const r=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(action+JSON.stringify(value));return value;},{action,data});
const step=async(name,run)=>{console.log('Begin '+name);await appendFile(join(evidence,'progress.log'),'Begin '+name+'\n');await run();steps.push(name);await page.screenshot({path:join(evidence,steps.length+'-'+name+'.png')});console.log('Passed '+name);};
const command=async(name,id)=>{await page.keyboard.press('ControlOrMeta+k');await page.locator('.aui-command-palette input').fill(name);const option=page.locator(`[role="option"][id$="-${id}"]`);await expect(option).not.toHaveAttribute('aria-disabled','true');await option.click();};
let design,partId,assemblyId;
const graph=async()=>{const saved=await api('library/read',{app:'cad',id:design});return JSON.parse(execFileSync('python3',['-c','import sys,io,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(z.read("state/graph.json").decode())'],{input:Buffer.from(saved.data_base64,'base64'),encoding:'utf8'}));};
const row=name=>components().getByRole('treeitem',{name:new RegExp('^'+name)});
const context=async(name,action)=>{await row(name).click({button:'right'});await page.getByRole('menuitem',{name:action,exact:true}).click();};
const saved=async(test)=>expect.poll(async()=>test(await graph()),{timeout:90000}).toBe(true);
try{
 await page.goto(origin+'/cad/');await page.locator('input[name="username"]').fill('editor');await page.locator('input[name="password"]').fill('account-test-password-2026');await button('Sign in').click();await expect(page.locator('input[name="password"]')).toHaveCount(0,{timeout:30000});await page.waitForLoadState('networkidle');
 const document={format:'aether-part',formatVersion:22,documentId:randomUUID(),name:'Bracket',units:'millimeter',features:[
 {id:'profile',name:'Rectangle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[-20,-10],[20,-10],[20,10],[-20,10]]}},
 {id:'extrude',name:'Extrude',type:'extrude',profileFeatureId:'profile',suppressed:false,operation:'new',distanceMillimeters:12}]};
 const source=await api('library/create',{app:'cad',kind:'file',scope:'personal',operation_id:randomUUID(),name: 'Assembly baseline.aethercad', data_base64: partDocumentBase64(document)});
 await page.goto(`${origin}/cad/index.html?document=${source.id}`);await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});await button('Files').click();
 // One document type: the saved Part Studio and its Main Assembly are tabs of the same document.
 await expect(files).toContainText('Main Assembly');
 design=source.id;const project=(await api('library/project_read',{app:'cad',id:design})).project;partId=project.parts[0].id;assemblyId=project.assemblies[0].id;
 await page.goto(`${origin}/cad/index.html?document=${design}&assembly=${assemblyId}`);await expect(components()).toBeVisible({timeout:90000});if(!await files.isVisible())await button('Files').click();
 await step('first-drag-inserts-and-anchors',async()=>{
  await page.getByRole('button',{name:'Mate actions',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Insert Component…',exact:true})).toBeEnabled({timeout:90000});await page.keyboard.press('Escape');
  await files.locator(`[data-document-tab-id="${partId}"]`).dragTo(page.locator('#viewport'),{targetPosition:{x:680,y:420}});
  await saved(g=>g.instances.length===1);const g=await graph();assert.equal(g.instances[0].grounded,true);assert.equal(g.connector_definitions.length,1);assert.equal(g.connector_definitions[0].name,'Origin');await expect(row('Bracket:1')).toBeVisible();
 });
 await step('insert-second-component-and-edit-placement',async()=>{
  await page.getByRole('button',{name:'Mate actions',exact:true}).click();await page.getByRole('menuitem',{name:'Insert Component…',exact:true}).click();await dialog('Insert parts').getByRole('button',{name:'Bracket Part Studio',exact:true}).click();await page.locator('#assembly-position-x').fill('60');await dialog('Insert parts').getByRole('button',{name:'Insert Part',exact:true}).click();await expect(dialog('Insert parts')).toHaveCount(0,{timeout:90000});await saved(g=>g.instances.length===2);
  await context('Bracket:2','Component properties…');await dialog('Component properties').getByLabel('Name',{exact:true}).fill('Arm');await dialog('Component properties').getByLabel('Position Y',{exact:true}).fill('25');await dialog('Component properties').getByLabel('Rotation Z',{exact:true}).fill('30');
  const boxes=await Promise.all(['X','Y','Z'].map(axis=>dialog('Component properties').getByLabel('Position '+axis,{exact:true}).boundingBox()));assert.ok(boxes.every(b=>Math.abs(b.y-boxes[0].y)<2));
  await page.screenshot({path:join(evidence,'component-properties.png')});await dialog('Component properties').getByRole('button',{name:'Apply',exact:true}).click();await expect(dialog('Component properties')).toHaveCount(0,{timeout:90000});await saved(g=>g.instances.some(i=>i.name==='Arm'));
  const g=await graph(),arm=g.instances.find(i=>i.name==='Arm');assert.deepEqual(arm.rest_transform.position_m,[.06,.025,0]);assert.ok(Math.abs(arm.rest_transform.rotation_quaternion_xyzw[2]-Math.sin(Math.PI/12))<1e-9);assert.equal(arm.grounded,false);assert.equal(g.part_definitions.length,1);assert.equal(g.connector_definitions.length,1);
  await page.keyboard.press('ControlOrMeta+z');await saved(g=>!g.instances.some(i=>i.name==='Arm'));await page.keyboard.press('ControlOrMeta+Shift+z');await saved(g=>g.instances.some(i=>i.name==='Arm'));
 });
 await step('visibility-and-saved-reopen',async()=>{
  await context('Arm','Show / hide component');await saved(g=>g.instances.find(i=>i.name==='Arm').visible===false);await context('Arm','Show / hide component');await saved(g=>g.instances.find(i=>i.name==='Arm').visible===true);
  await page.reload();await expect(row('Arm')).toBeVisible({timeout:90000});await page.getByRole('button',{name:'Mate actions',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Insert Component…',exact:true})).toBeEnabled({timeout:90000});await page.keyboard.press('Escape');await row('Arm').dblclick();await expect.poll(async()=>Number(await dialog('Component properties').getByLabel('Position Y',{exact:true}).inputValue())).toBe(25);await dialog('Component properties').getByRole('button',{name:'Cancel',exact:true}).click();
 });
 await step('edit-source-part-and-reuse-updated-geometry',async()=>{
  await context('Arm','Open source Part');await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});assert.equal(new URL(page.url()).searchParams.get('part'),partId);
  await page.getByRole('treeitem',{name:/^Extrude/}).first().dblclick();const feature=page.locator('.cad-feature-dialog');await expect(feature).toBeVisible();await feature.locator('[aria-label="Distance (mm)"]').fill('18');await feature.locator('[data-feature-action="accept"]').click();await expect(feature).toHaveCount(0,{timeout:60000});
  await saved(g=>g.part_definitions[0].feature_document.features.find(f=>f.id==='extrude').distanceMillimeters===18);
  if(!await files.isVisible())await button('Files').click();await files.locator(`[data-document-tab-id="${assemblyId}"]`).click();await expect(row('Arm')).toBeVisible({timeout:90000});
  const g=await graph();assert.equal(g.instances.length,2);assert.equal(new Set(g.instances.map(i=>i.definition_id)).size,1);assert.equal(g.part_definitions[0].feature_document.features.find(f=>f.id==='extrude').distanceMillimeters,18);
  assert.equal((await api('library/read',{app:'cad',id:source.id})).revision,source.revision);
 });
 await step('specific-mate-button-on-first-use-and-free-coordinate',async()=>{
  // No generic Create Mate command has run. The ribbon's kind must work immediately.
  await command('Revolute','assembly-mate-revolute');const mate=dialog('Create Assembly mate');await expect(mate).toBeVisible();await expect(page.locator('#assembly-mate-type')).toHaveValue('revolute');
  await mate.getByRole('button',{name:'Preview Solve',exact:true}).click();await expect(mate.getByRole('button',{name:'Apply Mate',exact:true})).toBeEnabled({timeout:90000});await mate.getByRole('button',{name:'Apply Mate',exact:true}).click();await expect(mate).toHaveCount(0,{timeout:90000});await saved(g=>g.mates.length===1);
  await context('Arm','Component properties…');await expect(dialog('Component properties').getByLabel('Position X',{exact:true})).toBeDisabled();await dialog('Component properties').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.reload();await expect(row('Arm')).toBeVisible({timeout:90000});const g=await graph();assert.equal(g.mates[0].type_id,'revolute');assert.equal(g.mates[0].dofs.length,1);
 });
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({steps,errors,design,source:source.id},null,2));console.log('Part/Assembly acceptance passed: '+steps.length+' workflows');
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});await writeFile(join(evidence,'failure.json'),JSON.stringify({error:String(error),errors,steps,url:page.url()},null,2));throw error;}finally{await browser.close();}
