#!/usr/bin/env node
// Viewport picks fill feature windows (Jonathan, 2026-11-02): Extrude takes a cell region of
// a split, tilted L with construction lines and builds; Revolve's axis box fills from a
// click on a construction line of the sketch and the revolve builds. Runs on Studio's
// disposable authenticated host like the other verify-*-browser gates.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN ?? process.argv[2];
assert.ok(origin, 'usage: verify-region-pick-browser.mjs <origin>');
const evidence = process.env.AETHER_FRONTEND_EVIDENCE ?? join(process.cwd(), 'build', 'region-pick-browser');
await mkdir(evidence, { recursive: true });
const engine = process.env.AETHER_GATE_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: process.env.AETHER_HEADED !== '1', args: engine === chromium ? ['--ignore-certificate-errors', '--enable-unsafe-webgpu', '--use-angle=metal'] : [] });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const featureRow = name => page.getByRole('treeitem', { name }).first();
const dialog = () => page.locator('.cad-feature-dialog');
const dialogText = async () => (await dialog().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
const ribbon = async (name) => { const button = page.getByRole('button', { name, exact: true }).first(); if (await button.isVisible().catch(() => false)) { await button.click(); return; } await page.keyboard.press('ControlOrMeta+k'); const box = page.locator('.cad-document-bar .aui-command-search input').first(); await box.waitFor({ timeout: 10000 }); await box.fill(name); await page.getByRole('option', { name: new RegExp('^' + name + '\\b') }).first().click(); };
const sketchId = 'sketch-pick';
// Where a sketch point is on screen (set by main.ts for the finished-sketch display probe).
const at = async (x, y) => { const p = await page.evaluate(([id, px, py]) => window.__aetherFinishedSketchClientPoint?.(id, px, py), [sketchId, x, y]); assert.ok(p, `sketch point ${x},${y} is on screen`); return p; };
const clickAt = async (x, y) => { const [cx, cy] = await at(x, y); await page.mouse.click(cx, cy); await page.waitForTimeout(600); };
const apply = async (name) => {
  const accept = dialog().locator('[data-feature-action="accept"]');
  try { await expect(accept).toBeEnabled({ timeout: 30000 }); } catch { throw Error(`${name}: Apply stayed disabled — window says: ${await dialogText()}`); }
  await accept.click();
  await expect(dialog()).toHaveCount(0, { timeout: 30000 });
  await page.waitForTimeout(800);
  const text = await page.locator('body').innerText();
  assert.ok(!/could not be rebuilt/.test(text), `${name}: ` + text.match(/.{0,160}could not be rebuilt.{0,200}/)?.[0]);
};
// A tilted L (10°) split by the arm's edge continuing across the bar, plus two construction
// lines: one well clear of the profile (a valid revolve axis), one poking through an edge.
const rot = ([x, y]) => { const a = 10 * Math.PI / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; };
const path = (id, points, construction) => ({ id, type: 'path', start: rot(points[0]), segments: points.slice(1).map((p, i) => ({ id: `${id}-${i}`, type: 'line', end: rot(p) })), ...(construction ? { construction: true } : {}) });
const doc = { format: 'aether-part', formatVersion: 22, documentId: randomUUID(), name: 'Region pick', units: 'millimeter', features: [
  { id: sketchId, type: 'profile', name: 'Sketch 1', suppressed: false, plane: 'XZ', offsetMillimeters: 0, profile: { type: 'drawing', contours: [
    path('c-l', [[0, 0], [60, 0], [60, 20], [20, 20], [20, 100], [0, 100], [0, 0]]),
    path('c-s', [[20, 0], [20, 20]]),
    path('k-axis', [[-30, -10], [-30, 110]], true),
    path('k-through', [[50, 10], [70, 30]], true),
  ] } },
] };
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const file = await page.evaluate(async (data) => { const r = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) throw Error(await r.text()); return r.json(); }, { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Region pick.acpart', data_base64: Buffer.from(JSON.stringify(doc)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await featureRow(/Sketch 1/).waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  const fit = page.locator('.cad-studio-view-tools').getByRole('button', { name: 'Fit view', exact: true });
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1200);

  // Extrude the arm cell (Region 2) by clicking inside it.
  await ribbon('Extrude');
  await dialog().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await clickAt(...rot([40, 10]));
  const regionBox = dialog().locator('.aui-feature-entities[aria-label^="Faces and sketch regions to extrude"]');
  await expect(regionBox).toContainText(/Region/, { timeout: 10000 });
  await page.screenshot({ path: join(evidence, '1-extrude-picked.png') });
  await apply('Extrude');
  await featureRow(/Extrude/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, '2-extruded.png') });
  // Hovering the body is one proximity rule (Jonathan, 2026-11-03): an edge within reach outlines
  // itself, a face lights up, and a sweep of moves must not slow down over time.
  {
    const box = await page.locator('.cad-studio-viewport canvas').first().boundingBox();
    const sweep = async (count) => { const start = Date.now(); for (let i = 0; i < count; i++) { await page.mouse.move(box.x + box.width * (0.3 + 0.4 * ((i * 7) % 23) / 23), box.y + box.height * (0.3 + 0.4 * ((i * 11) % 19) / 19)); } return (Date.now() - start) / count; };
    const first = await sweep(60), later = await sweep(60);
    assert.ok(later < Math.max(first * 3, 40), `hover slowed from ${first.toFixed(1)} ms to ${later.toFixed(1)} ms per move`);
    const edgeSeen = await page.evaluate(() => new Promise((resolve) => {
      const tried = new Set(); const canvas = document.querySelector('.cad-studio-viewport canvas'); const rect = canvas.getBoundingClientRect();
      let n = 0; const step = () => { n++; if (n > 400) return resolve(false); const x = rect.left + rect.width * (0.2 + 0.6 * ((n * 13) % 97) / 97), y = rect.top + rect.height * (0.2 + 0.6 * ((n * 29) % 89) / 89);
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse' }));
        if (window.__aetherHover?.()?.kind === 'edge') return resolve(true); requestAnimationFrame(step); }; step(); }));
    assert.ok(edgeSeen, 'moving across the body hovers an edge somewhere');
  }
  // Bodies hide and show from the Parts list (Jonathan, 2026-11-02): the eye shows on hover,
  // hides the body in the viewport, and stays pinned on the row until it shows the body again.
  const partRow = page.locator('.cad-parts-list').getByRole('treeitem').first();
  await partRow.waitFor({ timeout: 10000 });
  await partRow.hover();
  await expect(partRow.getByRole('button', { name: /^Hide / })).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: join(evidence, '2a-part-hover-eye.png') });
  await partRow.getByRole('button', { name: /^Hide / }).click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(800);
  assert.deepEqual(await page.evaluate(() => window.__aetherPartVisibility?.()), [false], 'the body is hidden in the viewport');
  await expect(partRow).toHaveClass(/aui-tree-row--dimmed/, { timeout: 10000 }); // hidden rows grey out; the eye returns on hover
  await page.screenshot({ path: join(evidence, '2b-part-hidden.png') });
  await partRow.hover();
  await expect(partRow.getByRole('button', { name: /^Show / })).toBeVisible({ timeout: 10000 });
  await partRow.getByRole('button', { name: /^Show / }).click();
  await page.mouse.move(5, 5);
  await partRow.hover();
  await expect(partRow.getByRole('button', { name: /^Hide / })).toBeVisible({ timeout: 10000 });
  assert.deepEqual(await page.evaluate(() => window.__aetherPartVisibility?.()), [true], 'the body shows again');
  // The consumed sketch is hidden and its menu offers Show.
  await featureRow(/Sketch 1/).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /^Show/ }).first()).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Escape');

  // Revolve the bar cell about the construction line beside it, picked in the viewport.
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1200);
  await ribbon('Revolve');
  await dialog().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(evidence, '3a-revolve-open.png') });
  await clickAt(...rot([10, 30]));
  await page.screenshot({ path: join(evidence, '3b-revolve-region-click.png') });
  await expect(dialog().locator('.aui-feature-entities[aria-label^="Faces and sketch regions to revolve"]')).toContainText(/Region/, { timeout: 10000 });
  await clickAt(...rot([-30, 30]));
  const axisBox = dialog().locator('.aui-feature-entities[aria-label^="Revolve axis"]');
  await expect(axisBox).toContainText(/Line/, { timeout: 10000 });
  await page.screenshot({ path: join(evidence, '3-revolve-axis-picked.png') });
  await apply('Revolve');
  await featureRow(/Revolve/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, '4-revolved.png') });

  // Sketch 2 is drawn with the sketch tools, as a user does: a rectangle and a separate line
  // beside it. Its lines get identities on commit, so the line can be a revolve axis.
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(800);
  await ribbon('Sketch');
  await page.locator('.cad-sketch-workspace.choosing-plane').waitFor({ timeout: 30000 });
  await featureRow(/Front Plane/).click();
  await page.locator('.cad-sketch-window').waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const draw = async (tool, points) => {
    await ribbon(tool); await page.waitForTimeout(300);
    for (const [x, y] of points) { const at2 = await page.evaluate(([px, py]) => window.__aetherSketchClientPoint?.(px, py), [x, y]); assert.ok(at2, `sketch point ${x},${y} is on screen`); await page.mouse.click(at2[0], at2[1]); await page.waitForTimeout(200); }
    await page.keyboard.press('Escape');
  };
  await draw('Rectangle', [[-60, -15], [-20, 15]]);
  await draw('Line', [[-80, -30], [-80, 30]]);
  const acceptSketch = page.locator('.cad-sketch-window [data-feature-action="accept"]');
  await expect(acceptSketch).toBeEnabled({ timeout: 30000 });
  await acceptSketch.click();
  await expect(page.locator('.cad-sketch-window')).toHaveCount(0, { timeout: 60000 });
  await featureRow(/Sketch 2/).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1200);
  await ribbon('Revolve');
  await dialog().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  const at2 = async (x, y) => { const p = await page.evaluate(([name, px, py]) => window.__aetherFinishedSketchClientPoint?.(name, px, py), ['Sketch 2', x, y]); assert.ok(p, `Sketch 2 point ${x},${y} is on screen`); return p; };
  const click2 = async (x, y) => { const [cx, cy] = await at2(x, y); await page.mouse.click(cx, cy); await page.waitForTimeout(600); };
  await click2(-40, 0);
  await expect(dialog().locator('.aui-feature-entities[aria-label^="Faces and sketch regions to revolve"]')).toContainText(/Region/, { timeout: 10000 });
  await click2(-80, 10);
  await expect(dialog().locator('.aui-feature-entities[aria-label^="Revolve axis"]')).toContainText(/Line/, { timeout: 10000 });
  await page.screenshot({ path: join(evidence, '5-drawn-sketch-axis-picked.png') });
  await apply('Revolve about a drawn line');
  await featureRow(/Revolve 5|Revolve/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, '6-drawn-sketch-revolved.png') });

  // A line of another, earlier sketch is a valid axis too: Sketch 2's rectangle about Sketch 1's
  // construction line that pokes past the L (clear of the rectangle).
  if (await fit.isEnabled().catch(() => false)) await fit.click();
  await page.waitForTimeout(1200);
  await ribbon('Revolve');
  await dialog().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await click2(-40, 0);
  await expect(dialog().locator('.aui-feature-entities[aria-label^="Faces and sketch regions to revolve"]')).toContainText(/Sketch 2 · Region/, { timeout: 10000 });
  await clickAt(...rot([60, 20]));
  await expect(dialog().locator('.aui-feature-entities[aria-label^="Revolve axis"]')).toContainText(/Sketch 1 · Line/, { timeout: 10000 });
  await page.screenshot({ path: join(evidence, '7-other-sketch-axis-picked.png') });
  await apply('Revolve about another sketch\'s line');
  await page.screenshot({ path: join(evidence, '8-other-sketch-revolved.png') });
  const fatal = errors.filter(e => !/favicon|ResizeObserver/.test(e));
  assert.deepEqual(fatal, [], 'console errors: ' + fatal.join(' | '));
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed: true }, null, 1));
  console.log('PASS region and construction-line picks fill Extrude and Revolve and both build');
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), `${error?.stack ?? error}\nwindow: ${await dialogText()}`);
  throw error;
} finally {
  await browser.close();
}
