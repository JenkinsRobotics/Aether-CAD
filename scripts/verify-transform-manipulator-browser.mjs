/** Selection manipulator on a disposable authenticated host, through real UI/native rebuilds. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,expect}=createRequire(fileURLToPath(new URL('../../AetherStudio/core/files/package.json',import.meta.url)))('@playwright/test');
const origin=process.env.AETHER_TEST_ORIGIN,evidence=process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'8780');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
const errors=[],steps=[];page.on('pageerror',e=>errors.push(e.message));
const request=(action,data)=>page.evaluate(async({action,data})=>{const response=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw Error(await response.text());return response.json();},{action,data});
let file;
const read=async()=>JSON.parse(Buffer.from((await request('library/read',{app:'cad',id:file.id})).data_base64,'base64'));
const count=async n=>expect.poll(async()=>(await read()).features.length,{timeout:30000}).toBe(n);
const gizmo=page.locator('.cad-selection-manipulator'),handle=id=>gizmo.locator(`[data-transform-handle="${id}"]`);
const center=async id=>{const b=await handle(id).boundingBox();assert.ok(b);return{x:b.x+b.width/2,y:b.y+b.height/2};};
const project=points=>page.evaluate(points=>{let result;window.dispatchEvent(new CustomEvent('aether-measure-project',{detail:{points,respond:value=>result=value}}));return result;},points);
const step=async(name,action)=>{console.log('Begin '+name);await action();steps.push(name);await page.screenshot({path:join(evidence,name+'.png')});console.log('Passed '+name);};
const parts=()=>page.locator('.cad-parts-list').getByRole('treeitem');
const select=async()=>{await parts().first().click();await expect(handle('pivot')).toBeVisible();};
try{
 await page.goto(origin+'/cad/');await page.locator('input[name="username"]').fill('editor');await page.locator('input[name="password"]').fill('account-test-password-2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('input[name="password"]')).toHaveCount(0,{timeout:30000});await page.waitForLoadState('networkidle');
 const data=JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.acpart',import.meta.url),'utf8'));data.documentId=randomUUID();data.name='Transform manipulator check';
 file=await request('library/create',{app:'cad',kind:'file',scope:'personal',operation_id:randomUUID(),name:'Manipulator.acpart',data_base64:Buffer.from(JSON.stringify(data)).toString('base64')});
 await page.goto(`${origin}/cad/index.html?document=${file.id}`);await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});
 await page.locator('.cad-studio-view-tools').getByRole('button',{name:'Fit view',exact:true}).click();await page.mouse.move(720,480);await page.mouse.wheel(0,650);await page.waitForTimeout(800);
 const originalCount=data.features.length;
 await step('selection-center',async()=>{await select();const [projected]=await project([[5,10,2.5]]),p=await center('pivot');assert.ok(Math.hypot(projected.x-p.x,projected.y-p.y)<2);await expect(gizmo.locator('[data-transform-handle]:visible')).toHaveCount(10);});
 await step('pivot-snap-and-free-placement',async()=>{
  const from=await center('pivot'),[corner]=await project([[10,20,5]]);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(corner.x,corner.y,{steps:10});await expect(page.locator('.cad-topology-anchor[data-active="true"]')).toHaveAttribute('data-kind','vertex');await page.mouse.up();
  await expect.poll(async()=>{const at=await center('pivot'),[currentCorner]=await project([[10,20,5]]);return Math.hypot(at.x-currentCorner.x,at.y-currentCorner.y);}).toBeLessThan(2);assert.equal((await read()).features.length,originalCount);
  await page.keyboard.down('Shift');await page.mouse.click(1000,420);await page.keyboard.up('Shift');await expect.poll(async()=>{const placed=await center('pivot');return Math.hypot(placed.x-1000,placed.y-420);}).toBeLessThan(2);assert.equal((await read()).features.length,originalCount);
  await handle('pivot').dblclick();const [expected]=await project([[5,10,2.5]]);await expect.poll(async()=>{const reset=await center('pivot');return Math.hypot(reset.x-expected.x,reset.y-expected.y);}).toBeLessThan(2);
 });
 await step('cancel-and-axis-commit',async()=>{
  const from=await center('moveX');await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+40,from.y+20,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();assert.equal((await read()).features.length,originalCount);
  await handle('moveX').focus();await page.keyboard.press('ArrowRight');await count(originalCount+1);assert.deepEqual((await read()).features.at(-1).transform,{kind:'translate',translationMillimeters:[1,0,0]});
  await page.keyboard.press('ControlOrMeta+z');await count(originalCount);await page.keyboard.press('ControlOrMeta+Shift+z');await count(originalCount+1);await select();
 });
 await step('plane-drag',async()=>{
  const at=await center('planeZ');await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(at.x+25,at.y+18,{steps:8});await page.mouse.up();await count(originalCount+2);
  const t=(await read()).features.at(-1).transform;assert.equal(t.kind,'translate');assert.ok(Math.abs(t.translationMillimeters[2])<1e-8);assert.ok(Math.hypot(...t.translationMillimeters)>0.1);
 });
 await step('rotation-at-custom-pivot',async()=>{
  const doc=await read(),offset=doc.features.filter(f=>f.transform?.kind==='translate').reduce((sum,f)=>sum.map((n,i)=>n+f.transform.translationMillimeters[i]),[0,0,0]);
  const corner=[10+offset[0],20+offset[1],5+offset[2]],[at]=await project([corner]),from=await center('pivot');await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(at.x,at.y,{steps:10});await page.mouse.up();
  await handle('rotateZ').focus();await page.keyboard.press('ArrowRight');await count(originalCount+3);const transform=(await read()).features.at(-1).transform;assert.equal(transform.kind,'rotate');assert.equal(transform.angleDegrees,15);transform.axisOriginMillimeters.forEach((n,i)=>assert.ok(Math.abs(n-corner[i])<1e-7));
 });
 await step('copy-and-reopen',async()=>{
  await gizmo.getByRole('button',{name:'Copy while moving'}).click();await handle('moveX').focus();await page.keyboard.press('ArrowRight');await count(originalCount+4);await expect(parts()).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');await count(originalCount+3);await expect(parts()).toHaveCount(1);await page.keyboard.press('ControlOrMeta+Shift+z');await count(originalCount+4);await expect(parts()).toHaveCount(2);
  const saved=await read();await writeFile(join(evidence,'manipulator.acpart'),JSON.stringify(saved,null,2));await page.reload();await expect(parts()).toHaveCount(2,{timeout:90000});assert.deepEqual(await read(),saved);await select();
 });
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'results.json'),JSON.stringify({steps,errors},null,2));
}catch(e){await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});await writeFile(join(evidence,'failure.txt'),String(e.stack)+'\n'+JSON.stringify({steps,errors}));throw e;}finally{await browser.close();}
