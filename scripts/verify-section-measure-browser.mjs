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
const options = async () => { await button('Environment options').click(); };

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
  const screenshots = [];
  const choose = async (label, option) => {
    await button(label).click(); await page.getByRole('option', { name: option, exact: true }).click();
  };
  const project = async points => page.evaluate(points => {
    let result; window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points, respond: value => { result = value; } } })); return result;
  }, points);
  const pick = async point => {
    const [at, center] = await project([point, [5,10,5]]);
    // A tiny inset keeps the ray on the face; the picker still snaps to the exact vertex.
    const length = Math.hypot(center.x-at.x, center.y-at.y) || 1;
    await page.mouse.click(at.x+(center.x-at.x)/length*2, at.y+(center.y-at.y)/length*2);
  };
  await button('Fit view').click();
  await page.mouse.move(720, 480); await page.mouse.wheel(0, 650); await page.waitForTimeout(800);
  await button('Measure').click();
  await expect(page.locator('.cad-studio-view-tools [data-icon="tape-measure"]')).toHaveCount(1);
  await choose('Measure selection', 'Bodies');
  await pick([5,10,5]);
  await expect(page.getByRole('region', { name: 'Measurements' })).toContainText('1000', { timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'body-properties.png') });
  await choose('Measurement mode', 'Point-to-point');
  await pick([10,0,5]); await pick([10,20,5]);
  await expect(page.getByRole('region', { name: 'Measurements' })).toContainText('20.00');
  await expect(page.locator('.cad-measure-label')).toBeVisible();
  const before = await page.locator('.cad-measure-label').boundingBox();
  const canvas = page.locator('canvas.viewport-canvas'); const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.65); await page.mouse.wheel(0, 300);
  await page.waitForTimeout(800);
  const after = await page.locator('.cad-measure-label').boundingBox();
  assert.ok(Math.abs(before.x-after.x)+Math.abs(before.y-after.y)>1, 'measurement label follows zoom');
  await choose('Length unit', 'Inch');
  await expect(page.locator('.cad-measure-label')).toContainText('0.787 in');
  await page.screenshot({ path: join(evidence, 'point-distance.png') });
  await choose('Measurement mode', '3-point angle');
  await pick([10,0,5]); await pick([10,20,5]); await pick([0,20,5]);
  await expect(page.getByRole('region', { name: 'Measurements' })).toContainText('90.00');
  await page.screenshot({ path: join(evidence, 'three-point-angle.png') });
  await button('Clear selection').click();
  await expect(page.getByRole('region', { name: 'Measurements' })).toHaveCount(0);
  await button('Done').click(); await expect(page.locator('.cad-measure-overlay')).toHaveCount(0);
  await button('Section view').click();
  await button('Add section plane').click(); await page.getByRole('menuitem', { name: 'Top plane', exact: true }).click();
  const offset = page.getByRole('textbox', { name: 'Section offset', exact: true });
  await offset.fill('2.5'); await offset.press('Tab');
  await expect.poll(async () => Number(await offset.inputValue())).toBe(2.5);
  await page.screenshot({ path: join(evidence, 'section-offset-dark.png') });
  await page.getByRole('checkbox', { name: 'Flip cut' }).check();
  await page.screenshot({ path: join(evidence, 'section-reversed-dark.png') });
  await page.getByRole('checkbox', { name: 'Show plane' }).uncheck();
  await button('Accept section view').click();
  await button('Section view').click(); await page.getByRole('menuitem', { name: 'Edit section view…', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Flip cut' })).toBeChecked();
  await expect.poll(async () => Number(await offset.inputValue())).toBe(2.5);
  await offset.fill('4'); await offset.press('Tab'); await button('Cancel').click();
  await button('Section view').click(); await page.getByRole('menuitem', { name: 'Edit section view…', exact: true }).click();
  await expect.poll(async () => Number(await offset.inputValue())).toBe(2.5);
  await page.evaluate(() => {
    document.documentElement.dataset.aetherTheme = 'light'; document.documentElement.classList.add('aether-light-theme');
    document.querySelectorAll('.aether-theme-model-studio').forEach(node => node.classList.add('aether-light-theme'));
  });
  await page.screenshot({ path: join(evidence, 'section-light.png') });
  await button('Cancel').click();
  await button('Section view').click(); await page.getByRole('menuitem', { name: 'Turn off section view', exact: true }).click();
  await expect(button('Section view')).toHaveAttribute('aria-pressed','false');
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, errors }, null, 2));
  console.log('Built CAD: exact object values, vertex picks, 3-point angle, units, zoom annotations, section offset/flip/accept/cancel/off and themes passed.');
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') });
  await writeFile(join(evidence, 'failure.txt'), await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
