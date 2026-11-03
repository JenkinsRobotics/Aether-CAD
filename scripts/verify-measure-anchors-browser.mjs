/** Section and Measure against a disposable host; never writes to live user documents. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
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
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.part.json', import.meta.url), 'utf8'));
  data.documentId = randomUUID(); data.name = 'Measurement anchors check';
  const file = await page.evaluate(async ({ encoded, operation }) => {
    const response = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', kind: 'file', scope: 'personal', operation_id: operation, name: 'Measurement anchors check.aethercad', data_base64: encoded }) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, { encoded: partDocumentBase64(data), operation: randomUUID() });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
  const screenshots = [];
  const choose = async (label, option) => {
    await button(label).click(); await page.getByRole('option', { name: option, exact: true }).click();
  };
  const project = async points => page.evaluate(points => {
    let result; window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points, respond: value => { result = value; } } })); return result;
  }, points);

  const cloud = page.locator('.cad-topology-anchors');
  const active = cloud.locator('.cad-topology-anchor[data-active="true"]');
  const hover = async point => { const [at] = await project([point]); await page.mouse.move(at.x, at.y); return at; };
  const pick = async (point, outward = 0, center = [5,10,5]) => {
    const [at, middle] = await project([point, center]);
    const distance = Math.hypot(at.x-middle.x,at.y-middle.y) || 1;
    const x = at.x+(at.x-middle.x)/distance*outward, y = at.y+(at.y-middle.y)/distance*outward;
    await page.mouse.move(x,y);
    await expect(active).toHaveCount(1);
    await page.mouse.click(x,y);
  };
  const clear = () => button('Clear selection').click();
  const result = page.getByRole('region', { name: 'Measurements' });
  await button('Fit view').click();
  await page.mouse.move(720,480); await page.mouse.wheel(0,650); await page.waitForTimeout(800);
  await button('Measure').click();
  await choose('Measurement mode','Point-to-point');
  await hover([5,10,5]);
  await expect(cloud.locator('.cad-topology-anchor')).toHaveCount(9);
  await expect(active).toHaveAttribute('data-kind','face-center');
  await page.screenshot({ path: join(evidence,'face-anchors-dark.png') });
  await pick([5,10,5]); await pick([10,10,5]);
  await expect(result).toContainText(/5\.0+ mm/);
  await expect(active).toHaveAttribute('data-kind','edge-midpoint');
  await page.screenshot({ path: join(evidence,'midpoint-to-face-center.png') });
  await clear();
  await pick([10,0,5],6); await pick([10,20,5],6);
  await expect(result).toContainText(/20\.0+ mm/);
  await expect(active).toHaveAttribute('data-kind','vertex');
  await page.screenshot({ path: join(evidence,'corners-outside-silhouette.png') });
  await pick([10,20,5],6);
  await expect(result).toHaveCount(0);
  await expect(page.locator('.cad-measure-hint')).toContainText('(1/2)');
  await pick([10,20,5],6);
  await choose('Length unit','Inch');
  await expect(page.locator('.cad-measure-label')).toContainText('0.787 in');
  await page.mouse.move(720,650); await page.mouse.wheel(0,300); await page.waitForTimeout(800);
  await clear(); await pick([10,0,5],6); await pick([10,20,5],6);
  await expect(result).toContainText('0.787 in');
  await choose('Measurement mode','3-point angle');
  await pick([10,0,5]); await pick([10,20,5]); await pick([0,20,5]);
  await expect(result).toContainText(/90\.0+ deg/);
  await button('Done').click(); await expect(cloud.locator('.cad-topology-anchor')).toHaveCount(0);

  // Connector placement uses the identical inference picker, including frames.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search CAD commands', { exact:true }).fill('Place Mate Connector');
  await page.getByRole('option', { name:/Place Mate Connector/ }).click();
  await hover([5,10,5]);
  await expect(cloud.locator('.cad-topology-anchor')).toHaveCount(9);
  await pick([5,10,5]);
  await expect(page.locator('#status-message')).toContainText('placed on');
  await page.screenshot({path:join(evidence,'mate-connector-anchors.png')});
  await page.keyboard.press('Escape');
  await expect(cloud.locator('.cad-topology-anchor')).toHaveCount(0);

  const cylinder = structuredClone(data);
  cylinder.documentId = randomUUID(); cylinder.name = 'Shaft anchors';
  cylinder.features[0].profile = {type:'circle',centerMillimeters:[5,10],radiusMillimeters:5};
  cylinder.features[1].distanceMillimeters=20;
  const shaft = await page.evaluate(async ({ encoded, operation }) => {
    const response = await fetch('/api/library/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({app:'cad',kind:'file',scope:'personal',operation_id:operation,name: 'Shaft anchors.aethercad', data_base64: encoded}) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, {encoded: partDocumentBase64(cylinder), operation: randomUUID()});
  await page.goto(`${origin}/cad/index.html?document=${shaft.id}`);
  await page.getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});
  await button('Fit view').click();
  await page.mouse.move(720,480); await page.mouse.wheel(0,650); await page.waitForTimeout(800);
  await button('Measure').click(); await choose('Measurement mode','Point-to-point');
  await hover([5,10,20]);
  await expect(active).toHaveAttribute('data-kind',/circle-center|cylinder-axis/);
  await pick([5,10,20]);
  await hover([10,10,10]);
  await expect(cloud.locator('[data-kind="cylinder-axis"]')).toHaveCount(3);
  await pick([5,10,10]);
  await expect(result).toContainText(/10\.0+ mm/);
  await page.screenshot({path:join(evidence,'shaft-axis-distance.png')});
  await page.evaluate(() => {
    document.documentElement.dataset.aetherTheme='light'; document.documentElement.classList.add('aether-light-theme');
    document.querySelectorAll('.aether-theme-model-studio').forEach(node=>node.classList.add('aether-light-theme'));
  });
  await hover([10,10,10]);
  await page.screenshot({path:join(evidence,'shaft-anchors-light.png')});
  await choose('Measurement mode','Objects');
  await expect(cloud.locator('.cad-topology-anchor')).toHaveCount(0);
  await button('Done').click();
  assert.deepEqual(errors, []);
  await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,errors},null,2));
  console.log('Built CAD: face clouds, corners beyond silhouette, midpoints/centers, zoom tolerance, exact distances/angle/units, shared mate connector anchors, circle and shaft axis points, mode/close cleanup and light/dark checks passed.');
} catch (error) {
  await page.screenshot({path:join(evidence,'failure.png')});
  await writeFile(join(evidence,'failure.txt'),await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
