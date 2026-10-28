/** Exercise the actual toolbar shortcuts and Boolean commits on a disposable host. */
import assert from 'node:assert/strict';
import { verifyIntegratedToolbar } from './browser/integrated-toolbar.mjs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, expect } = createRequire(fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [], steps = [];
let geometryRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/\/api\/cad\/(geometry|analysis)/.test(request.url())) geometryRequests++; });
const request = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text());
  return response.json();
}, { action, data });
let file;
const saved = async () => JSON.parse(Buffer.from((await request('library/read', { app: 'cad', id: file.id })).data_base64, 'base64'));
const dialog = () => page.locator('.cad-feature-dialog');
const cancel = () => dialog().locator('[data-feature-action="discard"]').click();
const menu = () => page.locator('button[aria-label="Modify tools"]:visible').first().click();
const open = async label => { await menu(); await page.getByRole('menuitem', { name: label, exact: true }).click(); await expect(dialog()).toBeVisible(); };
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.acpart', import.meta.url), 'utf8'));
  data.documentId = randomUUID(); data.name = 'Toolbar operations check';
  data.features.push({ ...structuredClone(data.features[0]), id: 'profile-2', name: 'Second profile', profile: { type: 'polygon', pointsMillimeters: [[5, 0], [15, 0], [15, 20], [5, 20]] } },
    { ...data.features[1], id: 'pad-2', name: 'Second body', profileFeatureId: 'profile-2' });
  file = await request('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Toolbar operations.acpart', data_base64: Buffer.from(JSON.stringify(data)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(2, { timeout: 90000 });
  await verifyIntegratedToolbar(page, expect, join(evidence, 'integrated-toolbar.png'));
  steps.push('integrated toolbar, search, categories, camera/display/filter state and responsive bounds');
  await menu();
  for (const name of ['Union', 'Subtract', 'Intersect', 'Offset Face', 'Replace Face', 'Align', 'Split Body'])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeEnabled();
  await page.screenshot({ path: join(evidence, 'modify-tools.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.aui-command-palette input').fill('Wrap & Emboss');
  await expect(page.locator('[role="option"][id$="-unavailable:solid-wrap-emboss"]')).toHaveAttribute('aria-disabled', 'true');
  await page.screenshot({ path: join(evidence, 'wrap-unavailable.png') });
  await page.keyboard.press('Escape'); steps.push('toolbar entries and unavailable wrap in feature search');
  await open('Offset Face');
  await expect(dialog().getByLabel('Face operation', { exact: true })).toHaveValue('offset');
  await expect(dialog().getByLabel('Replace with plane', { exact: true })).toHaveValue('no');
  await cancel();
  await open('Replace Face');
  await expect(dialog().getByLabel('Replace with plane', { exact: true })).toHaveValue('yes');
  await expect(dialog().getByLabel('Plane source', { exact: true })).toHaveValue('face');
  await page.screenshot({ path: join(evidence, 'replace-face.png') });
  await cancel(); steps.push('offset and replacement editor modes');
  for (const [label, operation] of [['Union', 'union'], ['Subtract', 'cut'], ['Intersect', 'intersection']]) {
    await open(label);
    await expect(dialog().getByLabel('Operation', { exact: true })).toHaveValue(operation);
    await dialog().locator('input[aria-label^="Use "]').first().check();
    const apply = dialog().locator('[data-feature-action="accept"]');
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await apply.click();
    await expect.poll(async () => (await saved()).features.length, { timeout: 30000 }).toBe(5);
    assert.equal((await saved()).features.at(-1).operation, operation);
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
    await page.screenshot({ path: join(evidence, label.toLowerCase() + '.png') });
    if (operation !== 'intersection') {
      const history = page.locator('.aui-integrated-toolbar-header');
      await history.getByRole('button', {name:'Undo',exact:true}).click();
      await expect.poll(async () => (await saved()).features.length).toBe(4);
      await history.getByRole('button', {name:'Redo',exact:true}).click();
      await expect.poll(async () => (await saved()).features.length).toBe(5);
      await history.getByRole('button', {name:'Undo',exact:true}).click();
      await expect.poll(async () => (await saved()).features.length).toBe(4);
      await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(2);
    }
    steps.push(label + ' native preview, commit and persistence');
  }
  await page.reload();
  await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1, { timeout: 90000 });
  assert.equal((await saved()).features.at(-1).operation, 'intersection');
  steps.push('saved intersection reopened');
  assert.equal(geometryRequests, 0); assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ steps, errors, geometryRequests }, null, 2));
  console.log('Toolbar modes, three exact Boolean operations, undo and saved reopen passed.');
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), String(error.stack) + '\n' + JSON.stringify({ steps, errors }));
  throw error;
} finally { await browser.close(); }
