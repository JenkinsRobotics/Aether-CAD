/** Grid horizon against a disposable host; never writes to live user documents. */
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
const button = name => page.getByRole('button', { name, exact: true });
const options = async () => { await button('Environment options').click(); };

try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.part.json', import.meta.url), 'utf8'));
  data.documentId = randomUUID(); data.name = 'Grid horizon check';
  const file = await page.evaluate(async ({ encoded, operation }) => {
    const response = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', kind: 'file', scope: 'personal', operation_id: operation, name: 'Grid horizon check.aethercad', data_base64: encoded }) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, { encoded: partDocumentBase64(data), operation: randomUUID() });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
  const screenshots = [];
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => {
      localStorage.setItem('aether-cad.appearance.studio-v2', JSON.stringify({
        environmentTheme: 'model-studio', floorMode: 'grid',
        ...(theme === 'light' ? { colorTransform: 'standard', exposure: 1, backgroundColor: '#f2f5f7', gridMinorColor: '#9aa4ad', gridMajorColor: '#7f8a94', gridMinorOpacityPercent: 45 } : {}),
      }));
    }, theme);
    await page.reload();
    await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
    await page.evaluate(theme => {
      document.documentElement.dataset.aetherTheme = theme;
      document.documentElement.classList.toggle('aether-light-theme', theme === 'light');
    }, theme);
    await button('Environment').click();
    for (const projection of ['Perspective', 'Orthographic']) {
      await options(); await page.getByRole('menuitem', { name: 'Camera', exact: true }).click();
      await page.getByRole('menuitemradio', { name: projection, exact: true }).click();
      await button('Home view').click();
      const canvas = page.locator('canvas.viewport-canvas');
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * .55, box.y + box.height * .6);
      for (let zoom = 0; zoom < 3; zoom++) {
        if (zoom) await page.mouse.wheel(0, 4500);
        await page.waitForTimeout(1800);
        const name = `${theme}-${projection.toLowerCase()}-zoom-${zoom}.png`;
        await page.screenshot({ path: join(evidence, name) }); screenshots.push(name);
      }
      await button('Top view').click(); await page.waitForTimeout(800);
      await page.screenshot({ path: join(evidence, `${theme}-${projection.toLowerCase()}-top.png`) });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, screenshots, errors }, null, 2));
  console.log('Built CAD: wheel zoom, camera projections, top views, themes and model rendering passed.');
} finally { await browser.close(); }
