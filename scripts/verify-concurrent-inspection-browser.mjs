/** Section and Measure against a disposable host; never writes to live user documents. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInspectionParity } from './browser/inspection-parity.mjs';
const { chromium, expect } = createRequire(fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => (['Measure','Section view','Fit view'].includes(name) ? page.locator('.cad-studio-view-tools') : page).getByRole('button', { name, exact: true });

try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.acpart', import.meta.url), 'utf8'));
  data.documentId = randomUUID(); data.name = 'Concurrent inspection check';
  const file = await page.evaluate(async ({ data, operation }) => {
    const response = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', kind: 'file', scope: 'personal', operation_id: operation, name: 'Concurrent inspection check.acpart', data_base64: btoa(JSON.stringify(data)) }) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, { data, operation: randomUUID() });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
  const builtHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const scripts = [...builtHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
  for (const source of scripts) {
    const url = new URL(source, origin + '/cad/').href;
    assert.ok(await page.locator('script[src]').evaluateAll((nodes,url)=>nodes.some(node=>node.src===url),url));
    const response = await page.request.get(url);
    assert.deepEqual(await response.body(), await readFile(new URL('../dist/'+source,import.meta.url)));
  }
  const project = async point => page.evaluate(point=>{let result; window.dispatchEvent(new CustomEvent('aether-measure-project',{detail:{points:[point],respond:value=>{result=value[0];}}}));return result;},point);
  const pixel = async point => {
    // Sample rendered material, excluding white DOM handles/measurement labels
    // that can cross the probe as the cutting plane moves.
    const at=await project(point), bytes=await page.screenshot({style:'.cad-section-handle, .cad-measure-overlay { visibility:hidden !important; }'});
    return page.evaluate(async({encoded,at})=>{const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob());const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);return [...ctx.getImageData(Math.round(at.x),Math.round(at.y),1,1).data];},{encoded:bytes.toString('base64'),at});
  };
  const isBody=p=>p[0]>150&&p[1]>150&&p[2]>150;
  const bodyAt=async(point,visible)=>expect.poll(async()=>isBody(await pixel(point))).toBe(visible);
  const section=page.locator('.cad-section-window'), measure=page.locator('.cad-measure-window');
  const offset=page.getByRole('textbox',{name:'Section offset',exact:true});
  const openCut=async()=>{
    await button('Section view').click(); await button('Add section plane').click();
    await page.getByRole('menuitem',{name:'Right plane',exact:true}).click(); await offset.fill('5');
  };
  const points=async()=>{await measure.getByRole('button',{name:'Measurement mode',exact:true}).click();await page.getByRole('option',{name:'Point-to-point',exact:true}).click();};
  const moveMeasure=async()=>{
    const header=await measure.locator('.aui-float-panel-header').boundingBox();
    await page.mouse.move(header.x+80,header.y+20);await page.mouse.down();await page.mouse.move(1350,header.y+20,{steps:8});await page.mouse.up();
  };
  const pick=async point=>{
    const at=await project(point),middle=await project([5,10,5]),length=Math.hypot(at.x-middle.x,at.y-middle.y);
    const x=at.x+(at.x-middle.x)/length*5,y=at.y+(at.y-middle.y)/length*5;
    await page.mouse.move(x,y);await expect(page.locator('.cad-topology-anchor[data-active="true"]')).toHaveCount(1);await page.mouse.click(x,y);
  };
  const result=page.getByRole('region',{name:'Measurements'});
  await button('Top view').press('Enter');await button('Fit view').click();
  await page.mouse.move(1000,600);await page.mouse.wheel(0,650);await page.waitForTimeout(800);
  if (!process.env.AETHER_INSPECTION_PARITY_ONLY) {
  await openCut();await bodyAt([2,10,5],true);await bodyAt([8,10,5],false);
  await button('Measure').click();await expect(section).toBeVisible();await expect(measure).toBeVisible();
  const a=await section.boundingBox(),b=await measure.boundingBox();assert.ok(b.x>=a.x+a.width+10,'new popup opens beside the section');
  await moveMeasure();await points();await pick([0,0,5]);await pick([0,20,5]);
  await expect(result).toContainText(/20\.0+ mm/);await expect(section.locator('.aui-feature-entity-select')).toHaveCount(1);
  await offset.fill('3');await bodyAt([8,10,5],false);await bodyAt([2,10,5],true);
  await expect(result).toContainText(/20\.0+ mm/);
  await measure.getByRole('button',{name:'Help',exact:true}).click();await page.keyboard.press('Escape');
  await expect(section).toBeVisible();await expect(measure).toBeVisible();await expect(result).toContainText(/20\.0+ mm/);
  await page.screenshot({path:join(evidence,'section-and-measure-dark.png')});
  await measure.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(measure).toHaveCount(0);await expect(section).toBeVisible();assert.equal(Number(await offset.inputValue()),3);await bodyAt([8,10,5],false);
  await button('Measure').click();await moveMeasure();await points();await pick([0,0,5]);await pick([0,20,5]);
  await section.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(section).toHaveCount(0);await expect(measure).toBeVisible();await expect(result).toContainText(/20\.0+ mm/);await bodyAt([8,10,5],true);
  await openCut();await expect(measure).toBeVisible();await expect(result).toContainText(/20\.0+ mm/);
  await page.evaluate(()=>{document.documentElement.classList.add('aether-light-theme');document.documentElement.dataset.aetherTheme='light';document.querySelectorAll('.aether-theme-model-studio').forEach(node=>node.classList.add('aether-light-theme'));});
  await page.screenshot({path:join(evidence,'section-and-measure-light.png')});
  await page.keyboard.press('Escape');await expect(section).toBeVisible(); // The number field consumes Escape to cancel its draft.
  await section.locator('.aui-float-panel-header').click({position:{x:85,y:20}});
  await page.keyboard.press('Escape');await expect(section).toHaveCount(0);await expect(measure).toBeVisible();
  await expect(result).toContainText(/20\.0+ mm/);await measure.getByRole('button',{name:'Done',exact:true}).click();
  }
  await verifyInspectionParity({page,expect,button,project,evidence});
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,errors},null,2));
  console.log('Built CAD: independent section and measurement windows, real snap picks, live clipped pixels, retained distance, both opening/closing orders, focus, Help/Escape, placement and themes passed.');
} catch(error) {
  await page.screenshot({path:join(evidence,'failure.png')});await writeFile(join(evidence,'failure.txt'),String(error.stack));throw error;
} finally {await browser.close();}
