/** Pick the rim between two cones, from either face, through the actual editor. */
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
  const dx = side * shoulder.radius * 0.002;
  const radius = shoulder.radius + dx * shoulder.slopes[side < 0 ? 0 : 1];
  const bounds = await dialog().boundingBox();
  for (const degrees of [45, 60, 30, 75, 15]) {
    const angle = degrees * Math.PI / 180;
    const point = await page.evaluate(p => window.__aetherClientPoint(...p), [shoulder.x + dx, -radius * Math.sin(angle), radius * Math.cos(angle)]);
    if (!point || point[0] < 250 || point[1] < 110 || point[1] > 800 ||
      (point[0] >= bounds.x - 10 && point[0] <= bounds.x + bounds.width + 10 && point[1] >= bounds.y - 10 && point[1] <= bounds.y + bounds.height + 10)) continue;
    await page.mouse.move(...point);
    await page.screenshot({ path: join(evidence, `hover-${side}.png`) });
    await page.mouse.click(...point);
    return;
  }
  throw Error('The conical shoulder is obscured by the dialog');
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
  for (const name of ['Fillet', 'Chamfer']) {
    const file = await api('create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: `${name} conical shoulder.aethercad`, data_base64: partDocumentBase64(fixture) });
    await page.goto(`${origin}/cad/index.html?document=${file.id}`);
    await page.getByRole('treeitem', { name: /^Revolve/ }).first().waitFor({ timeout: 90000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.__aetherSetView('isometric'));
    await page.waitForTimeout(1200);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.cad-document-bar .aui-command-search input').first().fill(name);
    await page.locator(`[role="option"][id$="-feature-${name.toLowerCase()}"]`).first().click();
    const entities = dialog().locator(`.aui-feature-entities[aria-label^="Entities to ${name.toLowerCase()}"]`);
    for (const side of [-1, 1]) {
      if (side > 0) await entities.getByRole('button', { name: /Remove/ }).click();
      await pick(side);
      await expect(entities).toContainText('Edge of Revolve', { timeout: 10000 });
      const edge = JSON.parse(await dialog().locator('[aria-label="Picked edges"]').inputValue())[0];
      assert.equal(edge.kind, 'curved-edge');
      assert.ok(Math.abs(edge.midpointMillimeters[0] - shoulder.x) < 1e-5);
      assert.ok(Math.abs(edge.lengthMillimeters - shoulder.radius * Math.PI / 2) < 1e-5);
    }
    const handle = page.getByRole('button', { name: name === 'Fillet' ? 'Fillet radius' : 'Chamfer size', exact: true });
    await expect(handle).toBeEnabled({ timeout: 45000 });
    await handle.press('ArrowUp');
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
    await page.screenshot({ path: join(evidence, name.toLowerCase() + '-preview.png') });
    await accept();
    await expect.poll(async () => (await saved(file.id)).features.at(-1).type, { timeout: 30000 }).toBe(name.toLowerCase());
    const firstSize = (await saved(file.id)).features.at(-1).radiusMillimeters;
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('treeitem', { name: new RegExp('^' + name) }).first().dblclick({ timeout: 90000 });
    await entities.getByRole('button', { name: /Remove/ }).click();
    await pick(-1);
    await expect(entities).toContainText('Edge of Revolve');
    await expect(handle).toBeEnabled({ timeout: 45000 });
    await handle.press('ArrowUp');
    await accept();
    // Observe the edited geometry in durable storage before leaving this page.
    // Reading the previous feature alone can race the debounced autosave.
    await expect.poll(async () => (await saved(file.id)).features.at(-1).radiusMillimeters, { timeout: 30000 }).toBeGreaterThan(firstSize);
    await page.waitForLoadState('networkidle');
    const document = await saved(file.id);
    await writeFile(join(evidence, name.toLowerCase() + '.part.json'), JSON.stringify(document, null, 2));
    results.push(`${name}: shoulder selected from both cones, shared handle preview, apply, saved reopen and history reselection`);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'conical-finish.json'), JSON.stringify({ browser: engine === webkit ? 'webkit' : 'chromium', results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') });
  await writeFile(join(evidence, 'failure.txt'), `${error.stack}\n${await dialog().allTextContents()}`);
  throw error;
} finally { await browser.close(); }
