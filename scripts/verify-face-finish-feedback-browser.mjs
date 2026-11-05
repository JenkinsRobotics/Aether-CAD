/** Whole-face finishes and persistent error feedback through the actual editor. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';

const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE)('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const engine = process.env.AETHER_GATE_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, ...(engine === chromium ? { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const dialog = () => page.locator('.cad-feature-dialog');
const api = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/library/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text());
  return response.json();
}, { action, data });
const saved = async id => tabDocumentOf((await api('read', { app: 'cad', id })).data_base64);
const synthetic = { format: 'aether-part', formatVersion: 22, documentId: randomUUID(), name: 'Tapered shoulder', units: 'millimeter', features: [
  { id: 's', name: 'Sketch 1', type: 'profile', plane: 'XZ', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'polygon', pointsMillimeters: [[0, 10], [0, 30], [8, 30], [10, 25], [30, 24], [30, 10]] } },
  { id: 'r', name: 'Revolve 2', type: 'revolve', profileFeatureId: 's', axis: 'X', angleDegrees: 90, operation: 'new', suppressed: false },
] };
const fixture = process.env.AETHER_CONICAL_PART ? JSON.parse(await readFile(process.env.AETHER_CONICAL_PART, 'utf8')) : synthetic;
const shoulder = process.env.AETHER_CONICAL_SHOULDER ? JSON.parse(process.env.AETHER_CONICAL_SHOULDER) : { x: 10, radius: 25, slopes: [-2.5, -0.05] };
const pick = async side => {
  const dx = side * shoulder.radius * (side < 0 ? .012 : .25);
  const radius = shoulder.radius + dx * shoulder.slopes[side < 0 ? 0 : 1];
  const bounds = await dialog().boundingBox();
  for (const degrees of [45, 60, 30, 75, 15]) {
    const angle = degrees * Math.PI / 180;
    const point = await page.evaluate(p => window.__aetherClientPoint(...p), [shoulder.x + dx, -radius * Math.sin(angle), radius * Math.cos(angle)]);
    if (!point || point[0] < 250 || point[1] < 110 || point[1] > 800 ||
      (point[0] >= bounds.x - 10 && point[0] <= bounds.x + bounds.width + 10 && point[1] >= bounds.y - 10 && point[1] <= bounds.y + bounds.height + 10)) continue;
    await page.mouse.click(...point);
    return await page.evaluate(p => window.__aetherClientPoint(...p), [shoulder.x, -shoulder.radius * Math.sin(angle), shoulder.radius * Math.cos(angle)]);
  }
  throw Error('The conical face is obscured by the dialog');
};
const redPixels = async at => {
  const bytes = await page.screenshot({ style: '.cad-feature-dialog { opacity:0 !important; }' });
  return page.evaluate(async ({ encoded, at }) => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + encoded)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap,0,0); bitmap.close();
    const pixels = ctx.getImageData(Math.round(at[0])-8,Math.round(at[1])-8,17,17).data;
    let red = 0; for (let i=0;i<pixels.length;i+=4) if(pixels[i]>180 && pixels[i+1]<140 && pixels[i+2]<150) red++;
    return red;
  }, { encoded: bytes.toString('base64'), at });
};
const accept = async () => {
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  await dialog().locator('[data-feature-action="accept"]').click();
  await expect(dialog()).toHaveCount(0);
};
try {
  await page.goto(origin + '/cad/');
  // Let the unauthenticated account bootstrap finish before sign-in navigates.
  // WebKit reports a cancelled in-flight status request as a page error.
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible({ timeout: 30000 });
  await page.waitForLoadState('networkidle');
  for (const name of ['Fillet', 'Chamfer']) for (const side of [-1, 1]) {
    const file = await api('create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: `Whole ${name} face ${side}.aethercad`, data_base64: partDocumentBase64(fixture) });
    await page.goto(`${origin}/cad/index.html?document=${file.id}`);
    await page.getByRole('treeitem', { name: /^Revolve/ }).first().waitFor({ timeout: 90000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.__aetherSetView('isometric')); await page.waitForTimeout(1200);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.cad-document-bar .aui-command-search input').first().fill(name);
    await page.locator(`[role="option"][id$="-feature-${name.toLowerCase()}"]`).first().click();
    const entities = dialog().locator(`.aui-feature-entities[aria-label^="Entities to ${name.toLowerCase()}"]`);
    const at = await pick(side);
    const edge = JSON.parse(await dialog().locator('[aria-label="Picked edges"]').inputValue())[0];
    assert.equal(edge.kind, 'face-edges', 'Clicking the interior must pick all face boundaries');
    assert.equal(edge.surfaceType, 'cone');
    const radius = dialog().locator(name === 'Fillet' ? 'input[aria-label^="Radius"]' : 'input[aria-label="Distance (mm)"]');
    await radius.fill(String(.508 / Number(await radius.getAttribute('data-canonical-factor') ?? 1))); await radius.press('Tab');
    await expect(dialog().locator('[data-feature-validation]')).toHaveAttribute('data-feature-validation', 'valid', { timeout: 60000 });
    const label = await entities.innerText();
    await radius.fill(String(10000 / Number(await radius.getAttribute('data-canonical-factor') ?? 1))); await radius.press('Tab');
    await expect(dialog().locator('[data-feature-validation]')).toHaveAttribute('data-feature-validation', 'error', { timeout: 60000 });
    await expect(entities).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('treeitem', { name: new RegExp('^' + name) }).first()).toHaveClass(/aui-tree-row--error/);
    assert.equal(await entities.innerText(), label, 'Failed previews preserve every selected input');
    await expect.poll(() => redPixels(at), { timeout: 10000 }).toBeGreaterThan(8);
    await page.screenshot({ path: join(evidence, `${name.toLowerCase()}-face-${side}-error.png`) });
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
    await radius.fill(String(.508 / Number(await radius.getAttribute('data-canonical-factor') ?? 1))); await radius.press('Tab');
    await expect(dialog().locator('[data-feature-validation]')).toHaveAttribute('data-feature-validation', 'valid', { timeout: 60000 });
    await expect(entities).toHaveAttribute('aria-invalid', 'false');
    await page.screenshot({ path: join(evidence, `${name.toLowerCase()}-face-${side}-corrected.png`) });
    await accept();
    await expect.poll(async () => (await saved(file.id)).features.at(-1).radiusMillimeters, { timeout: 30000 }).toBeCloseTo(.508, 6);
    await page.waitForLoadState('networkidle'); await page.reload(); await page.waitForLoadState('networkidle');
    await page.getByRole('treeitem', { name: new RegExp('^' + name) }).first().dblclick({ timeout: 90000 });
    await expect(dialog().locator('[data-feature-validation]')).toHaveAttribute('data-feature-validation', 'valid', { timeout: 60000 });
    assert.equal(JSON.parse(await dialog().locator('[aria-label="Picked edges"]').inputValue())[0].kind, 'face-edges');
    await page.screenshot({ path: join(evidence, `${name.toLowerCase()}-face-${side}-reopened.png`) });
    await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('canvas.viewport-canvas')).toHaveAttribute('data-feature-input-state', '');
    await writeFile(join(evidence, `${name.toLowerCase()}-face-${side}.part.json`), JSON.stringify(await saved(file.id), null, 2));
    results.push(`${name} cone ${side}: whole face selected, 0.020 in preview, oversized error retains red boundaries, correction, save and editable reopen`);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'face-finish-feedback.json'), JSON.stringify({ browser: engine === webkit ? 'webkit' : 'chromium', results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') });
  await writeFile(join(evidence, 'failure.txt'), `${error.stack}\n${await dialog().allTextContents()}`);
  throw error;
} finally { await browser.close(); }
