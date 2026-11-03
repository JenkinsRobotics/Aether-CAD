/** Actual hosted history playback: pixels, timing, pause/stop and no persistence. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
const {chromium,webkit,expect}=createRequire(new URL('../../AetherStudio/core/files/package.json',import.meta.url))('@playwright/test');
const origin=process.env.AETHER_TEST_ORIGIN,evidence=process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'8780');
await mkdir(evidence,{recursive:true});
const browserName=process.env.AETHER_HISTORY_BROWSER??'chromium';
const browser=await(browserName==='webkit'?webkit:chromium).launch({headless:true,...(browserName==='webkit'?{}:{args:['--enable-unsafe-webgpu','--use-angle=metal']})});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(25000);
const errors=[],writes=[],steps=[];page.on('pageerror',error=>errors.push(error.message));
const button=name=>page.getByRole('button',{name,exact:true});
const request=(action,data)=>page.evaluate(async({action,data})=>{
  const response=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  if(!response.ok)throw Error(await response.text());return response.json();
},{action,data});
const read=async id=>tabDocumentOf((await request('library/read',{app:'cad',id})).data_base64);
const solidAt=async point=>{
  const [at]=await page.evaluate(point=>{let value;window.dispatchEvent(new CustomEvent('aether-measure-project',{detail:{points:[point],respond:v=>value=v}}));return value;},point);
  assert.ok(at.x>610&&at.x<1080&&at.y>360&&at.y<760,JSON.stringify(at));
  const bytes=await page.screenshot();
  return page.evaluate(async({encoded,at})=>{
    const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return Math.max(...ctx.getImageData(Math.round(at.x),Math.round(at.y),1,1).data.slice(0,3))>90;
  },{encoded:bytes.toString('base64'),at});
};
try{
  await page.goto(origin+'/cad/');await page.locator('input[name="username"]').fill('editor');await page.locator('input[name="password"]').fill('account-test-password-2026');await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Get started',exact:true})).toBeVisible();
  await page.waitForLoadState('networkidle');
  const source=JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.part.json',import.meta.url),'utf8'));
  source.formatVersion=22;source.documentId=randomUUID();source.name='History playback qualification';source.rollbackIndex=3;
  source.features.push(...[20,10].map((distance,i)=>({id:'move-'+i,name:'Move '+(i+1),type:'transform',suppressed:false,bodyIds:[source.documentId+':body-1'],transform:{kind:'translate',translationMillimeters:[distance,0,0]}})));
  const file=await request('library/create',{app:'cad',kind:'file',scope:'personal',operation_id:randomUUID(),name: 'Playback.aethercad', data_base64: partDocumentBase64(source)});
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await page.locator('[aria-label="CAD features"]').getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});
  await button('Version control').click();await page.getByRole('radio',{name:'History',exact:true}).click();
  const panel=page.locator('.cad-history-playback-panel');
  const play=()=>panel.getByRole('button',{name:'Play feature history',exact:true});
  const progress=()=>panel.getByRole('progressbar',{name:'Feature playback progress'});
  await expect(play()).toBeEnabled();
  await page.locator('.cad-studio-view-tools').getByRole('button',{name:'Fit view',exact:true}).click();await button('Top view').press('Enter');
  await page.mouse.move(800,450);for(let i=0;i<11;i++){await page.mouse.wheel(0,400);await page.waitForTimeout(80);}await page.waitForTimeout(300);
  await expect.poll(()=>solidAt([25,10,5])).toBe(true);
  const saved=await read(file.id);
  page.on('request',req=>{if(req.method()!=='GET'&&/\/api\/(?:library\/(?:save|update|create)|cad\/.*commit)/.test(req.url()))writes.push(req.url());});
  await panel.getByLabel('History playback speed').selectOption('0.5');await play().click();
  for(let index=1;index<=4;index++){
    await expect(progress()).toHaveAttribute('value',String(index));
    if(index<4)await panel.getByRole('button',{name:'Pause history playback',exact:true}).click();
    await expect(panel.getByText('Building…',{exact:true})).toHaveCount(0);
    await expect(panel.locator(`[data-history-rollback-index="${index-1}"]`)).toHaveAttribute('data-current','true');
    const occupied=index<2?null:[5,25,35][index-2];
    await page.screenshot({path:join(evidence,`step-${index}.png`)});
    for(const x of [5,25,35])await expect.poll(()=>solidAt([x,10,5]),{message:`Step ${index}, x=${x}`}).toBe(x===occupied);
    steps.push({index,label:await panel.locator('.cad-history-playback-step').innerText(),timing:await panel.locator('.cad-history-playback-timing').innerText()});
    if(index<4){await page.waitForTimeout(250);await expect(progress()).toHaveAttribute('value',String(index));await panel.getByRole('button',{name:'Resume history playback',exact:true}).click();}
  }
  await expect(panel.getByText('Complete',{exact:true})).toBeVisible();
  assert.deepEqual(await read(file.id),saved);
  await panel.getByRole('button',{name:'Stop history playback'}).click();
  await expect(panel.getByRole('slider',{name:'History rollback'})).toHaveAttribute('aria-valuenow','3');
  await expect.poll(()=>solidAt([25,10,5])).toBe(true);await expect.poll(()=>solidAt([35,10,5])).toBe(false);
  await play().click();await expect(progress()).toHaveAttribute('value','1');await page.keyboard.press('Escape');
  await expect(progress()).toHaveCount(0);await expect.poll(()=>solidAt([25,10,5])).toBe(true);
  await page.waitForTimeout(1500);assert.deepEqual(await read(file.id),saved);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(evidence,'restored.png')});
  await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,browser:browserName,steps,writes,errors,originalRollback:3},null,2));
  console.log('PASS history playback, pixels, pause/resume, cancel, original rollback and unchanged saved document');
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});throw error;}finally{await browser.close();}
