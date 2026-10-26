/** Section and Measure against a disposable host; never writes to live user documents. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, expect } = createRequire(fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
  data.documentId = randomUUID(); data.name = 'Section and Measure check';
  const file = await page.evaluate(async ({ data, operation }) => {
    const response = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', kind: 'file', scope: 'personal', operation_id: operation, name: 'Section and Measure check.acpart', data_base64: btoa(JSON.stringify(data)) }) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, { data, operation: randomUUID() });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
  const canvas=page.locator('canvas.viewport-canvas');
  const project=async point=>page.evaluate(point=>{let result;window.dispatchEvent(new CustomEvent('aether-measure-project',{detail:{points:[point],respond:value=>{result=value[0];}}}));return result;},point);
  const pixel=async point=>{
    const at=await project(point),bytes=await page.screenshot();
    return page.evaluate(async({encoded,at})=>{const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob());const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return [...ctx.getImageData(Math.round(at.x),Math.round(at.y),1,1).data];},{encoded:bytes.toString('base64'),at});
  };
  const isCap=p=>p[0]>p[2]+25;
  const waitCap=async(point,expected)=>expect.poll(async()=>isCap(await pixel(point)),{timeout:15000}).toBe(expected);
  await button('Top view').press('Enter');await page.waitForTimeout(450);
  await button('Section view').click();
  const at=await project([5,10,5]);await page.mouse.click(at.x,at.y);
  const planes=page.locator('[aria-label="Section planes"]');
  await expect(planes.locator('.aui-feature-entity-select')).toHaveCount(1);
  const faceName=await planes.locator('.aui-feature-entity-select').first().innerText();
  const offset=page.getByRole('textbox',{name:'Section offset',exact:true});
  await offset.fill('-2.5'); // input alone must change the geometry
  await waitCap([5,10,2.5],true);
  await expect(offset).toBeFocused();
  const header=page.locator('.cad-section-window > .aui-float-panel-header');
  const bounds=await header.boundingBox();
  for(const label of ['Accept section view','Cancel']){const action=await button(label).boundingBox();assert.ok(Math.abs(action.height-bounds.height)<1);assert.ok(Math.abs(action.y-bounds.y)<1);}
  const cancel=await button('Cancel').boundingBox();assert.ok(Math.abs(cancel.x+cancel.width-bounds.x-bounds.width)<1);
  await button('Add section plane').click();await page.getByRole('menuitem',{name:'Right plane',exact:true}).click();
  await offset.fill('5');await waitCap([2,10,2.5],true);await waitCap([8,10,2.5],false);
  await expect(planes.locator('.aui-feature-entity-select')).toHaveCount(2);
  const positive=button('Move section in positive normal direction'),negative=button('Move section in negative normal direction');
  await expect(positive).toBeVisible();await expect(negative).toBeVisible();
  const plus=await positive.boundingBox(),minus=await negative.boundingBox();
  const center=await project([5,10,2.5]);
  assert.ok(Math.abs((plus.x+minus.x+plus.width)/2-center.x)<2&&Math.abs((plus.y+minus.y+plus.height)/2-center.y)<2,'default-plane arrows stay centered on the model');
  assert.equal(await planes.locator('.aui-feature-entity-select').first().evaluate(element=>getComputedStyle(element).borderTopWidth),'0px');
  const dx=plus.x-minus.x,dy=plus.y-minus.y,length=Math.hypot(dx,dy);
  await page.mouse.move(plus.x+plus.width/2,plus.y+plus.height/2);await page.mouse.down();
  await page.mouse.move(plus.x+plus.width/2+dx/length*30,plus.y+plus.height/2+dy/length*30,{steps:8});
  await expect.poll(async()=>Number(await offset.inputValue())).toBeGreaterThan(5);
  await page.screenshot({path:join(evidence,'live-drag.png')});await page.mouse.up();
  await negative.press('ArrowRight');await offset.fill('5');
  await page.getByRole('checkbox',{name:'Enable plane',exact:true}).uncheck();await waitCap([8,10,2.5],true);
  await page.getByRole('checkbox',{name:'Enable plane',exact:true}).check();await waitCap([8,10,2.5],false);
  await button(faceName).click();await expect.poll(async()=>Number(await offset.inputValue())).toBe(-2.5);
  await button('Right').click();await expect.poll(async()=>Number(await offset.inputValue())).toBe(5);
  await page.screenshot({path:join(evidence,'two-section-planes-dark.png')});
  await button('Accept section view').click();
  await button('Section view').click();await page.getByRole('menuitem',{name:'Edit section view…',exact:true}).click();
  await expect(planes.locator('.aui-feature-entity-select')).toHaveCount(2);
  await button('Remove Right').click();await waitCap([8,10,2.5],true);await button('Cancel').click();await waitCap([8,10,2.5],false);
  await button('Section view').click();await page.getByRole('menuitem',{name:'Edit section view…',exact:true}).click();
  await expect(planes.locator('.aui-feature-entity-select')).toHaveCount(2);
  await button('Home view').click();await page.waitForTimeout(450);
  await page.screenshot({path:join(evidence,'two-section-planes-perspective.png')});
  await page.evaluate(()=>{document.documentElement.classList.add('aether-light-theme');document.documentElement.dataset.aetherTheme='light';document.querySelectorAll('.aether-theme-model-studio').forEach(node=>node.classList.add('aether-light-theme'));});
  await page.screenshot({path:join(evidence,'two-section-planes-light.png')});
  await button('Top view').press('Enter');await page.waitForTimeout(450);
  await button('Cancel').click();await button('Section view').click();await page.getByRole('menuitem',{name:'Turn off section view',exact:true}).click();
  await waitCap([5,10,5],false);await expect(button('Section view')).toHaveAttribute('aria-pressed','false');
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,errors},null,2));
  console.log('Built CAD: live face cuts, multiple planes, directional dragging, independent offsets, disable, accept/cancel/off and full-height header buttons passed.');
} catch(error) {
  await page.screenshot({path:join(evidence,'failure.png')});await writeFile(join(evidence,'failure.txt'),String(error.stack));throw error;
} finally {await browser.close();}
