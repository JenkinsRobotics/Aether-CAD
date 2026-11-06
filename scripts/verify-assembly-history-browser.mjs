/** Native assembly example replay, pause/stop, visible geometry and no writes. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium, webkit, expect } = createRequire(new URL('../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const name = process.env.AETHER_HISTORY_BROWSER ?? 'chromium';
const browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true, ...(name === 'webkit' ? {} : { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], writes = [];
const monitor = setInterval(() => { void page.locator('.cad-history-playback').first().innerText({ timeout: 1000 }).then(text => writeFile(join(evidence, 'progress.json'), JSON.stringify({ text, errors }))).catch(() => {}); }, 5000);
page.on('pageerror', error => errors.push(error.message));
const button = label => page.getByRole('button', { name: label, exact: true });
const capture = async label => { const bytes = await page.screenshot({ clip: { x: 650, y: 170, width: 900, height: 680 } }); await writeFile(join(evidence, label + '.png'), bytes); return bytes.toString('base64'); };
const difference = (a, b) => page.evaluate(async ({ a, b }) => {
  const data = async encoded => { const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, image.width, image.height).data; };
  const [x, y] = await Promise.all([data(a), data(b)]); let count = 0;
  for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]) > 60) count++;
  return count;
}, { a, b });
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor'); await page.locator('input[name="password"]').fill('account-test-password-2026'); await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0); await page.waitForLoadState('networkidle');
  await page.goto(origin + '/cad/index.html?editor=1&example=scifirobot');
  await expect(page.getByRole('tree', { name: 'CAD features', exact: true })).toContainText('Front shell', { timeout: 90000 });
  await button('Version control').click(); await page.getByRole('radio', { name: 'History', exact: true }).click();
  const panel = page.locator('.cad-history-playback-panel');
  const play = () => panel.getByRole('button', { name: 'Play feature history', exact: true });
  const progress = () => panel.getByRole('progressbar', { name: 'Feature playback progress' });
  await expect(play()).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__aetherPartVisibility?.().length ?? 0), { timeout: 120000 }).toBe(65);
  await page.locator('.cad-studio-view-tools').getByRole('button', { name: 'Fit view', exact: true }).click();
  await page.waitForTimeout(800);
  const original = await capture('original');
  page.on('request', request => { if (request.method() !== 'GET' && /\/api\/library\/(save|update|create|project_save)/.test(request.url())) writes.push(request.url()); });
  await panel.getByLabel('History playback speed').selectOption('0.5'); await play().click();
  await expect(progress()).toHaveAttribute('value', '1', { timeout: 60000 }); await panel.getByRole('button', { name: 'Pause history playback', exact: true }).click();
  await expect(panel.getByText('Building…', { exact: true })).toHaveCount(0);
  const empty = await capture('first-sketch'); assert.ok(await difference(original, empty) > 2000, 'Replay must hide the original completed assembly');
  await panel.getByRole('button', { name: 'Resume history playback', exact: true }).click();
  await expect(progress()).toHaveAttribute('value', '2', { timeout: 60000 }); await panel.getByRole('button', { name: 'Pause history playback', exact: true }).click();
  await expect(panel.getByText('Building…', { exact: true })).toHaveCount(0);
  const first = await capture('first-solid'); assert.ok(await difference(first, empty) > 1000, 'The first native solid must appear');
  await panel.getByRole('button', { name: 'Stop history playback', exact: true }).click(); await page.waitForTimeout(300);
  assert.ok(await difference(original, await capture('restored')) < 1000, 'Stop must restore original placed geometry and materials');
  await panel.getByLabel('History playback speed').selectOption('4'); await play().click();
  await expect(progress()).toHaveAttribute('value', '224', { timeout: 360000 });
  await expect(panel.getByText('Complete', { exact: true })).toBeVisible();
  await expect(panel.locator('[data-current="true"]')).toBeInViewport(); await capture('complete');
  await panel.getByRole('button', { name: 'Stop history playback', exact: true }).click();
  await play().click(); await expect(progress()).toHaveAttribute('value', '1'); await page.keyboard.press('Escape');
  await expect(progress()).toHaveCount(0); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, browser: name, features: 224, writes, errors }, null, 2));
} catch (error) { await page.screenshot({ path: join(evidence, 'failure.png') }); throw error; }
finally { clearInterval(monitor); await browser.close(); }
