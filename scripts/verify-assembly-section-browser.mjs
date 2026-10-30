/** Pixel-level cutaway checks on a real assembly, using a disposable host. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium, webkit, expect } = createRequire(new URL('../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const backend = process.env.AETHER_SECTION_BROWSER ?? 'chromium';
const browser = await (backend === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(backend === 'webgpu' ? { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] } : {}),
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.addInitScript(() => localStorage.setItem('aether-cad.metrics-overlay', 'on'));
const errors = [], checks = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (/\/api\/library\/(create|save|project_part_save|project_assembly_save)$/.test(request.url())) writes.push(request.url());
});
const tool = name => page.locator('.cad-studio-view-tools').getByRole('button', { name, exact: true });
const button = name => page.getByRole('button', { name, exact: true });
const project = point => page.evaluate(point => {
  let result;
  window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points: [point], respond: points => { result = points[0]; } } }));
  return result;
}, point);
const pixel = async point => {
  const at = await project(point);
  const bytes = await page.screenshot({ style: '.cad-section-handle { visibility:hidden!important; }' });
  return page.evaluate(async ({ encoded, at }) => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + encoded)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return [...ctx.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data];
  }, { encoded: bytes.toString('base64'), at });
};
const bodyAt = async (point, expected, label) => {
  await expect.poll(async () => Math.max(...(await pixel(point)).slice(0, 3)) > 80, { timeout: 15000, message: label }).toBe(expected);
  checks.push(label);
};
const edit = async () => {
  await tool('Section view').click();
  await page.getByRole('menuitem', { name: 'Edit section view…', exact: true }).click();
};
const hover = async point => { const at = await project(point); await page.mouse.move(at.x, at.y); };
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.goto(origin + '/cad/?example=scifirobot');
  await page.getByRole('tree', { name: 'CAD assembly components' }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(4000);
  await tool('Fit view').click();
  await button('Top view').press('Enter');
  await page.waitForTimeout(500);
  const left = [-90, 20, 0], right = [90, 20, 0];
  await bodyAt(left, true, 'Whole assembly: left shell present');
  await bodyAt(right, true, 'Whole assembly: right shell present');
  const pipeline = await page.locator('.cad-metrics-overlay').innerText();
  assert.match(pipeline, backend === 'webkit' ? /WebGL2/ : /WebGPU/);
  if (!process.env.AETHER_SECTION_FACE_FIRST) {
  // Warm the hover material before changing the clipping layout.
  await hover([90, 20, 100]);
  await page.screenshot({ path: join(evidence, 'before.png') });
  await tool('Section view').click();
  await button('Add section plane').click();
  await page.getByRole('menuitem', { name: 'Right plane', exact: true }).click();
  await page.getByRole('textbox', { name: 'Section offset', exact: true }).fill('0');
  await button('Accept section view').click();
  await bodyAt(left, true, 'Cut assembly: left shell retained');
  await bodyAt(right, false, 'Cut assembly: right shell removed');
  await hover([-90, 20, 100]);
  await bodyAt(right, false, 'Hovering the cut body cannot restore removed surfaces');
  await page.screenshot({ path: join(evidence, 'section-top.png') });
  await button('Home view').click();
  await page.waitForTimeout(500);
  await page.mouse.move(20, 20);
  await page.screenshot({ path: join(evidence, 'section-interior.png') });
  await button('Top view').press('Enter');
  await page.waitForTimeout(500);
  await edit();
  await page.getByRole('checkbox', { name: 'Flip cut', exact: true }).check();
  await button('Accept section view').click();
  await bodyAt(left, false, 'Flipped cut: left shell removed');
  await bodyAt(right, true, 'Flipped cut: right shell retained');
  await hover([90, 20, 100]);
  await bodyAt(left, false, 'Highlighted reversed cut retains clipping');
  await page.screenshot({ path: join(evidence, 'section-flipped.png') });
  await tool('Section view').click();
  await page.getByRole('menuitem', { name: 'Turn off section view', exact: true }).click();
  await page.mouse.move(20, 20);
  await bodyAt(left, true, 'Turning section off restores left shell');
  await bodyAt(right, true, 'Turning section off restores right shell');
  }
  // A picked face with an inward offset must cut during editing, before Accept.
  // This is the Safari workflow reported on the optical carrier.
  await button('Home view').click();
  await page.waitForTimeout(450);
  await button('Front view').press('Enter');
  await page.waitForTimeout(450);
  await tool('Section view').click();
  const face = await project([60, -125.2, 142]);
  await page.mouse.click(face.x, face.y);
  const planes = page.locator('[aria-label="Section planes"] .aui-feature-entity-select');
  await expect(planes).toHaveCount(1);
  const pickedFace = await planes.innerText();
  assert.match(pickedFace, /^Face \d+$/, 'Picked faces use compact numbered labels');
  await page.getByRole('textbox', { name: 'Section offset', exact: true }).fill('-79.195');
  await button('Home view').click();
  await page.waitForTimeout(450);
  await button('Top view').press('Enter');
  await page.waitForTimeout(450);
  await page.mouse.move(20, 20);
  await page.screenshot({ path: join(evidence, 'face-preview.png') });
  await bodyAt([40,-100,142], false, 'Picked face preview removes front shell before Accept');
  await bodyAt([40,80,142], true, 'Picked face preview retains rear shell');
  await button('Home view').click();
  await page.waitForTimeout(450);
  await page.mouse.move(20, 20);
  await page.screenshot({ path: join(evidence, 'face-interior.png') });
  await button('Top view').press('Enter');
  await page.waitForTimeout(450);
  await page.getByRole('checkbox', { name: 'Flip cut', exact: true }).check();
  await bodyAt([40,-100,142], true, 'Flip face preview retains front shell');
  await bodyAt([40,80,142], false, 'Flip face preview removes rear shell');
  await button('Cancel').click();
  await bodyAt([40,80,142], true, 'Cancel face preview restores rear shell');
  checks.push(`Picked reference: ${pickedFace}`);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], 'Section inspection must not save or modify the example');
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, backend, pipeline, checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), String(error.stack));
  throw error;
} finally { await browser.close(); }
