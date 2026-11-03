#!/usr/bin/env node
// Fillet and Chamfer take edges picked in the viewport (Jonathan, 2026-11-02): a ring revolved
// a quarter turn, its outer arc filleted and its inner arc chamfered by clicking them, each
// window titled with the feature's name. Runs on Studio's disposable authenticated host.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN ?? process.argv[2];
assert.ok(origin, 'usage: verify-edge-finish-browser.mjs <origin>');
const evidence = process.env.AETHER_FRONTEND_EVIDENCE ?? join(process.cwd(), 'build', 'edge-finish-browser');
await mkdir(evidence, { recursive: true });
const engine = process.env.AETHER_GATE_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: process.env.AETHER_HEADED !== '1', args: engine === chromium ? ['--ignore-certificate-errors', '--enable-unsafe-webgpu', '--use-angle=metal'] : [] });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const featureRow = name => page.getByRole('treeitem', { name }).first();
const dialog = () => page.locator('.cad-feature-dialog');
const dialogText = async () => (await dialog().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
// A tool by its ribbon button when on screen, else through the command search; the palette
// item's id ends with the command id, which tells the solid Chamfer from the sketch one.
const ribbon = async (name, commandId) => { const button = page.getByRole('button', { name, exact: true }).first(); if (await button.isVisible().catch(() => false)) { await button.click(); return; } await page.keyboard.press('ControlOrMeta+k'); const box = page.locator('.cad-document-bar .aui-command-search input').first(); await box.waitFor({ timeout: 10000 }); await box.fill(name); await page.locator(`[role="option"][id$="-${commandId}"]`).first().click(); };
const clientPoint = (x, y, z) => page.evaluate(([px, py, pz]) => window.__aetherClientPoint?.(px, py, pz), [x, y, z]);
// Click a top arc of the ring (radius r, z = 10) wherever it is clear of the window and the side
// panels: arcs pick anywhere along them, so the angle is free. The point sits 0.3 mm inside the
// top face so the ray lands on a face and the arc is the nearest edge.
const clickArc = async (r, inset) => {
  const dialogBox = await dialog().boundingBox();
  for (const degrees of [5, 15, 30, 45, 60, 75, 85]) {
    const a = degrees * Math.PI / 180, p = await clientPoint((r + inset) * Math.cos(a), (r + inset) * Math.sin(a), 10);
    if (!p || p[0] < 260 || p[0] > 1240 || p[1] < 60 || p[1] > 760) continue;
    if (dialogBox && p[0] >= dialogBox.x - 8 && p[0] <= dialogBox.x + dialogBox.width + 8 && p[1] >= dialogBox.y - 8 && p[1] <= dialogBox.y + dialogBox.height + 8) continue;
    await page.mouse.click(p[0], p[1]); await page.waitForTimeout(600); return;
  }
  throw Error(`no point of the arc at radius ${r} is clear of the window`);
};
const apply = async (name) => {
  const accept = dialog().locator('[data-feature-action="accept"]');
  try { await expect(accept).toBeEnabled({ timeout: 30000 }); } catch { throw Error(`${name}: Apply stayed disabled — window says: ${await dialogText()}`); }
  await accept.click();
  await expect(dialog()).toHaveCount(0, { timeout: 30000 });
  await page.waitForTimeout(800);
  const text = await page.locator('body').innerText();
  assert.ok(!/could not be rebuilt/.test(text), `${name}: ` + text.match(/.{0,160}could not be rebuilt.{0,200}/)?.[0]);
};
// A ring r ∈ [10, 20], z ∈ [0, 10] revolved a quarter turn about Z: its arcs sit at 45°.
const doc = { format: 'aether-part', formatVersion: 22, documentId: randomUUID(), name: 'Edge finish', units: 'millimeter', features: [
  { id: 'rs', type: 'profile', name: 'Sketch 1', suppressed: false, plane: 'XZ', offsetMillimeters: 0, profile: { type: 'drawing', contours: [{ type: 'path', id: 'r', start: [10, 0], segments: [{ id: 'r0', type: 'line', end: [20, 0] }, { id: 'r1', type: 'line', end: [20, 10] }, { id: 'r2', type: 'line', end: [10, 10] }, { id: 'r3', type: 'line', end: [10, 0] }] }] } },
  { id: 'rev', type: 'revolve', name: 'Revolve 1', suppressed: false, profileFeatureId: 'rs', axis: 'Z', angleDegrees: 90, operation: 'new' },
] };
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const file = await page.evaluate(async (data) => { const r = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) throw Error(await r.text()); return r.json(); }, { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Edge finish.acpart', data_base64: Buffer.from(JSON.stringify(doc)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await featureRow(/Revolve 1/).waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  const fit = page.locator('.cad-studio-view-tools').getByRole('button', { name: 'Fit view', exact: true });
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1200);

  // Looking down the axis, the ring's top arcs lie flat on screen and clear of the window.
  await page.evaluate(() => window.__aetherSetView?.('top'));
  await page.waitForTimeout(800);
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1000);
  // Fillet the outer top arc, picked in the viewport; the window carries the feature's name.
  await ribbon('Fillet', 'feature-fillet');
  await dialog().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await expect(dialog().locator('.aui-feature-window-title, [class*="title"]').first()).toContainText(/Fillet \d+/, { timeout: 5000 });
  await clickArc(20, -0.3);
  await page.screenshot({ path: join(evidence, '1a-after-edge-click.png') });
  const filletBox = dialog().locator('.aui-feature-entities[aria-label^="Entities to fillet"]');
  try { await expect(filletBox).toContainText(/Edge of Revolve 1/, { timeout: 10000 }); }
  catch (error) { throw Error(`fillet edge pick: selection ${JSON.stringify(await page.evaluate(() => window.__aetherSelection?.()))}; window says: ${await dialogText()}`, { cause: error }); }
  await page.screenshot({ path: join(evidence, '1-fillet-edge-picked.png') });
  await dialog().locator('[aria-label="Radius (mm)"]').fill('2');
  await dialog().locator('[aria-label="Radius (mm)"]').dispatchEvent('change');
  const pickedEdges = await dialog().locator('[aria-label="Picked edges"]').inputValue();
  const windowText = await dialogText();
  try { await apply('Fillet'); }
  catch (error) { throw Error(`fillet apply: picked ${pickedEdges}; window said: ${windowText}`, { cause: error }); }
  await featureRow(/Fillet/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, '2-filleted.png') });

  // Chamfer the inner top arc with a distance and angle.
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1000);
  await ribbon('Chamfer', 'feature-chamfer');
  await dialog().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await clickArc(10, 0.3);
  // The body's latest feature names the pick (Onshape: "Edge of Fillet 1" after a fillet).
  await expect(dialog().locator('.aui-feature-entities[aria-label^="Entities to chamfer"]')).toContainText(/Edge of (Revolve 1|Fillet)/, { timeout: 10000 });
  await dialog().locator('[aria-label="Chamfer type menu"]').click();
  await page.getByRole('option', { name: 'Distance and angle' }).click();
  await expect(dialog().locator('[aria-label^="Angle ("]')).toBeVisible();
  await dialog().locator('[aria-label="Distance (mm)"]').fill('1');
  await dialog().locator('[aria-label="Distance (mm)"]').dispatchEvent('change');
  await page.screenshot({ path: join(evidence, '3-chamfer-edge-picked.png') });
  await apply('Chamfer');
  await featureRow(/Chamfer/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, '4-chamfered.png') });

  // A face is an entity too: clicking the ring's top face (away from its edges) fillets every edge of it.
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1000);
  await ribbon('Fillet', 'feature-fillet');
  await dialog().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await clickArc(15, 0); // mid-width of the top face at the first angle clear of the window: 5 mm from either arc
  await expect(dialog().locator('.aui-feature-entities[aria-label^="Entities to fillet"]')).toContainText(/Face of/, { timeout: 10000 });
  await dialog().locator('[aria-label="Radius (mm)"]').fill('0.3');
  await dialog().locator('[aria-label="Radius (mm)"]').dispatchEvent('change');
  await page.screenshot({ path: join(evidence, '5-face-picked.png') });
  await apply('Fillet by face');
  await page.screenshot({ path: join(evidence, '6-face-filleted.png') });
  assert.deepEqual(errors.filter(e => !/WebGPU|GPU|favicon/i.test(e)), [], 'no page errors');
  console.log('PASS fillet and chamfer take viewport edge picks on a revolved ring');
} finally {
  await browser.close();
}
