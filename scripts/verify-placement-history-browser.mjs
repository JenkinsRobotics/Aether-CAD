/** Legacy Part moves belong in History, with their saved geometry and commands intact. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
const { chromium, webkit, expect } = createRequire(fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await (process.env.AETHER_HISTORY_BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(20000);
const errors = [], steps = [], legacyRPC = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname === '/cad/rpc') legacyRPC.push(request.url()); });
const request = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text()); return response.json();
}, { action, data });
const read = async id => tabDocumentOf((await request('library/read', { app: 'cad', id })).data_base64);
const button = name => page.getByRole('button', { name, exact: true });
const features = () => page.locator('[aria-label="CAD features"]');
const history = () => page.locator('[aria-label="Editing history"]');
const menu = async (name, command) => {
  await button('Actions for ' + name).click();
  await page.getByRole('menuitem', { name: command, exact: true }).click();
};
const pixel = async point => {
  const [at] = await page.evaluate(point => { let result; window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points: [point], respond: value => result = value } })); return result; }, point);
  assert.ok(at.x > 600 && at.x < 1060 && at.y > 120 && at.y < 740, 'Pixel sample must be inside the unobscured viewport: ' + JSON.stringify(at));
  const bytes = await page.screenshot();
  return page.evaluate(async ({ encoded, at }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data];
  }, { encoded: bytes.toString('base64'), at });
};
const solidAt = async point => Math.max(...(await pixel(point)).slice(0, 3)) > 90;
const step = async (name, run) => { console.log('Begin ' + name); await run(); steps.push(name); await page.screenshot({ path: join(evidence, name + '.png') }); console.log('Passed ' + name); };
try {
  await page.goto(origin + '/cad/'); await page.locator('input[name="username"]').fill('editor'); await page.locator('input[name="password"]').fill('account-test-password-2026'); await button('Sign in').click();
  await page.waitForURL(url => url.pathname === '/cad/');
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.part.json', import.meta.url), 'utf8'));
  data.formatVersion = 22; data.documentId = randomUUID(); data.name = 'Legacy moved block';
  data.features.push(...[20, 10].map((distance, index) => ({ id: 'move-' + index, name: 'Move parts ' + (index + 1), type: 'transform', suppressed: false, bodyIds: [data.documentId + ':body-1'], transform: { kind: 'translate', translationMillimeters: [distance, 0, 0] } })));
  const file = await request('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Legacy moves.aethercad', data_base64: partDocumentBase64(data) });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`); await features().getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
  await button('Version control').click(); await page.getByRole('radio', { name: 'History', exact: true }).click();
  await page.locator('.cad-studio-view-tools').getByRole('button', { name: 'Fit view', exact: true }).click(); await button('Top view').press('Enter');
  await page.mouse.move(800, 450);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(80); }
  await page.waitForTimeout(300);
  await step('features-and-history-separated', async () => {
    await expect(page.getByText('Features (2)', { exact: true })).toBeVisible(); await expect(features()).not.toContainText('Move parts');
    await expect(history()).toContainText('Move parts 1'); await expect(history()).toContainText('Move parts 2');
    assert.deepEqual((await read(file.id)).features, data.features);
    await expect.poll(() => solidAt([35, 10, 5])).toBe(true);
    await expect.poll(() => solidAt([25, 10, 5])).toBe(false);
    await page.locator('.cad-parts-list').getByRole('treeitem').first().click();
    await expect(page.locator('.cad-selection-manipulator [data-transform-handle="pivot"]')).toBeHidden();
  });
  await step('history-suppression-undo-redo', async () => {
    await menu('Move parts 2', 'Suppress');
    await expect.poll(async () => (await read(file.id)).features[3].suppressed).toBe(true);
    await expect.poll(() => solidAt([25, 10, 5])).toBe(true);
    await expect.poll(() => solidAt([35, 10, 5])).toBe(false);
    await expect(button('Undo')).toBeEnabled(); await button('Undo').click();
    await expect.poll(async () => (await read(file.id)).features[3].suppressed).toBe(false);
    await expect.poll(() => solidAt([35, 10, 5])).toBe(true);
    await expect(button('Redo')).toBeEnabled(); await button('Redo').click();
    await expect.poll(async () => (await read(file.id)).features[3].suppressed).toBe(true);
    await menu('Move parts 2', 'Unsuppress');
    await expect.poll(async () => (await read(file.id)).features[3].suppressed).toBe(false);
    await expect(page.getByText('Features (2)', { exact: true })).toBeVisible(); await expect(features()).not.toContainText('Move parts');
  });
  await step('history-edit-and-reopen', async () => {
    await menu('Move parts 1', 'Edit…');
    const dialog = page.locator('.cad-feature-dialog');
    const translation = dialog.getByLabel('Translation X (mm)', { exact: true });
    await expect.poll(async () => Number(await translation.inputValue())).toBe(20); await translation.fill('30'); await translation.press('Tab');
    await dialog.locator('[data-feature-action="accept"]').click(); await expect(dialog).toBeHidden();
    await expect.poll(async () => (await read(file.id)).features[2].transform.translationMillimeters[0]).toBe(30);
    await expect.poll(() => solidAt([45, 10, 5])).toBe(true);
    await page.reload(); await features().getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
    await expect(page.getByText('Features (2)', { exact: true })).toBeVisible(); await expect(features()).not.toContainText('Move parts');
    await expect(history()).toContainText('Move parts 1');
    const saved = await read(file.id); assert.equal(saved.features.length, 4);
    assert.deepEqual(saved.features.slice(0, 2), data.features.slice(0, 2));
    assert.deepEqual(saved.features[2].transform.translationMillimeters, [30, 0, 0]);
    await writeFile(join(evidence, 'saved-part.json'), JSON.stringify(saved, null, 2));
  });
  assert.deepEqual(errors, []); assert.deepEqual(legacyRPC, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ steps, errors, legacyRPC }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), String(error.stack) + '\n' + JSON.stringify({ steps, errors })); throw error;
} finally { await browser.close(); }
