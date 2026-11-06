/** Unopened design Parts have real images without changing or saving the editor. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? new URL('../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browserName = process.env.AETHER_THUMBNAIL_BROWSER ?? 'chromium';
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true,
  ...(browserName === 'webkit' ? {} : { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }) });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(30000);
const errors = [], writes = [], projectReads = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (/\/api\/library\/(create|save|project_edit|cad_operation)$/.test(request.url())) writes.push(request.url());
  if (request.url().endsWith('/api/library/project_read')) projectReads.push(request.url());
});
const button = name => page.getByRole('button', { name, exact: true });
const panel = page.getByRole('region', { name: 'Files navigation', exact: true });
const parts = panel.locator('[data-document-tab-id]').filter({ hasText: 'Part Studio' });
const visibleShell = async () => {
  const point = await page.evaluate(() => {
    let result;
    window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points: [[90, 20, 0]], respond: points => { result = points[0]; } } }));
    return result;
  });
  const bytes = await page.screenshot();
  return page.evaluate(async ({ src, point }) => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return Math.max(...context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data.slice(0, 3)) > 80;
  }, { src: 'data:image/png;base64,' + bytes.toString('base64'), point });
};
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click(); await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.goto(origin + '/cad/?example=scifirobot');
  await page.getByRole('tree', { name: 'CAD assembly components' }).waitFor({ timeout: 90000 });
  await button('Files').click();
  await expect.poll(() => parts.count()).toBeGreaterThan(10);
  const count = await parts.count(), url = page.url(), started = Date.now();
  await expect(parts.locator('.aui-tab-browser-thumb img')).toHaveCount(count, { timeout: 120000 });
  const elapsed = Date.now() - started;
  const assemblies = panel.locator('[data-document-tab-id]').filter({ hasText: 'Assembly ·' });
  await expect(assemblies.first().locator('.aui-tab-browser-thumb img')).toHaveCount(1, { timeout: 120000 });
  const images = await parts.locator('.aui-tab-browser-thumb img').evaluateAll(async images => Promise.all(images.map(async image => {
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return { src: image.src, width: image.naturalWidth, height: image.naturalHeight, opaque };
  })));
  assert.ok(images.every(image => image.width === 320 && image.height === 240 && image.opaque > 10));
  assert.ok(new Set(images.map(image => image.src)).size > 5);
  assert.equal(page.url(), url); assert.deepEqual(writes, []); assert.deepEqual(projectReads, []);
  await page.locator('.cad-studio-view-tools').getByRole('button', { name: 'Fit view', exact: true }).click();
  await button('Top view').press('Enter');
  await expect.poll(visibleShell, { message: 'Main viewport remains rendered after all thumbnails' }).toBe(true);
  await page.screenshot({ path: join(evidence, 'all-unopened-parts.png') });
  const before = images.map(image => image.src);
  await parts.filter({ hasText: 'Optical carrier' }).locator('.aui-tab-browser-row').click();
  await page.getByRole('tree', { name: 'CAD features' }).waitFor({ timeout: 60000 });
  await expect(parts.locator('.aui-tab-browser-thumb img')).toHaveCount(count, { timeout: 60000 });
  assert.deepEqual(await parts.locator('.aui-tab-browser-thumb img').evaluateAll(images => images.map(image => image.src)), before);
  await page.screenshot({ path: join(evidence, 'part-navigation.png') });
  await page.reload();
  await expect(parts.locator('.aui-tab-browser-thumb img')).toHaveCount(count, { timeout: 120000 });
  assert.deepEqual(writes, []); assert.deepEqual(projectReads, []); assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, browser: browserName, count, elapsed, images: images.map(({ src, ...metrics }) => metrics), errors, writes, projectReads }, null, 2));
  console.log(`PASS ${count} unopened Part previews, pixels, navigation and reload (${browserName})`);
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') });
  await writeFile(join(evidence, 'failure-dom.txt'), await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
