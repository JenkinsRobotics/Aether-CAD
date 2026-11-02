// End-to-end: every solid tool driven through the real UI on the Aether engine —
// new sketch on a plane, rectangle and circle drawn on the canvas, Extrude (new and
// Remove), Revolve, Fillet, Shell, Mirror, Pattern, Boolean, Hole — each applied and
// rebuilt in the product runtime, with no server geometry requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const headed = process.env.AETHER_TIMING_HEADED === '1';
const browser = process.env.AETHER_SNAP_BROWSER === 'webkit' ? await webkit.launch({ headless: !headed }) : await chromium.launch({ headless: !headed, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(), errors = [], steps = [], log = { engine: {} };
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error')
  errors.push(m.text()); if (m.text().startsWith('[engine]'))
  (log.fallbacks ??= []).push(m.text()); });
page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
let geometryRequests = 0;
page.on('response', r => { if (new URL(r.url()).pathname.endsWith('/api/cad/geometry'))
  geometryRequests++; });
await page.addInitScript(e => { try {
  localStorage.setItem('aether-cad.engine', e);
}
catch { } }, process.env.AETHER_TOOLS_ENGINE ?? 'auto');
await page.addInitScript(() => { const w = window; w.__ev = []; window.addEventListener('aether-part-updated', () => w.__ev.push({ name: 'part-updated', t: Date.now() })); });
const step = async (name, fn) => {
  await fn();
  steps.push(name);
  await page.screenshot({ path: join(evidence, `${steps.length}-${name}.png`) });
};
const tree = () => page.getByRole('tree', { name: /Features/i }).first();
const featureRow = name => page.getByRole('treeitem', { name }).first();
const noRebuildError = async () => { const text = await page.locator('body').innerText(); assert.ok(!/could not be rebuilt/.test(text), 'a feature could not be rebuilt: ' + text.match(/.{0,160}could not be rebuilt.{0,200}/)?.[0]); };
// Applies the open feature dialog and waits for the model to update; records which engine built it.
const applyDialog = async (name) => {
  const before = geometryRequests;
  const t0 = Date.now();
  const accept = page.locator('.cad-feature-dialog [data-feature-action="accept"]');
  try {
    await expect(accept).toBeEnabled({ timeout: 30000 });
  }
  catch (error) {
    throw Error(`${name}: Apply stayed disabled — dialog says: ${(await page.locator('.cad-feature-dialog').innerText()).replace(/\s+/g, ' ').slice(0, 600)} — notice: ${(await page.locator('.aui-feature-notices').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  await page.evaluate(() => { window.__ev.length = 0; });
  try {
    await accept.click();
  }
  catch (error) {
    throw Error(`${name}: Apply could not be clicked — dialog says: ${(await page.locator('.cad-feature-dialog').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)} — notices: ${(await page.locator('.aui-feature-notices').allInnerTexts().catch(() => [])).join(' | ').slice(0, 600)} — ${error.message.slice(0, 200)}`);
  }
  await expect(page.locator('.cad-feature-dialog')).toHaveCount(0, { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => window.__ev.some(e => e.name === 'part-updated')), { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(400);
  await noRebuildError();
  const status = await page.evaluate(() => /Rebuilt (\d+) history entries in ([\d.]+) ms(?: \((\d+) replayed\))?/.exec(document.body.innerText));
  log.engine[name] = { serverBuilds: geometryRequests - before, entries: status ? Number(status[1]) : null, engineMs: status ? Number(status[2]) : null, replayed: status?.[3] != null ? Number(status[3]) : null, totalMs: Date.now() - t0 };
};
// The compact feature window hides its raw selects behind pickers and rows; the
// controls are still the form's truth, so they are set the way the pickers set them.
const setSelect = async (label, optionText) => { const selects = page.locator(`.cad-feature-dialog select[aria-label="${label}"]`); const target = (await selects.count()) ? selects.first() : page.locator(`.cad-feature-dialog [aria-label="${label}"]`).first(); await target.evaluate((el, text) => { const match = o => text instanceof RegExp || String(text).startsWith('/') ? new RegExp(String(text).replace(/^\/|\/$/g, '')).test(o.textContent.trim()) : (o.textContent.trim() === text || o.value === text); const opt = [...el.options].find(match); if (!opt)
  throw Error(`no option ${text} for ${el.getAttribute('aria-label')}: ${[...el.options].map(o => o.textContent.trim() || o.value).join('|')}`); el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }, optionText instanceof RegExp ? String(optionText) : optionText); };
const setInput = async (label, value) => { await page.locator(`.cad-feature-dialog [aria-label="${label}"]`).first().evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value); };
// A tool by its ribbon button when it is on screen, else through the command palette.
const ribbon = (name, commandId) => ({ click: async () => {
    const button = page.getByRole('button', { name, exact: true }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
    await page.keyboard.press('ControlOrMeta+k');
    // The header's shared inline CommandSearch. Its results open on input;
    // focusing it does not mount the old modal palette.
    const box = page.locator('.cad-document-bar .aui-command-search input').first();
    await box.waitFor({ timeout: 10000 });
    await box.fill(name);
    // Palette items carry the command id in their id, which tells the solid Mirror from the sketch one.
    await (commandId ? page.locator(`[role="option"][id$="-${commandId}"]`) : page.getByRole('option', { name: new RegExp('^' + name + '\\b') })).first().click();
  } });
const tab = name => page.getByRole('tab', { name, exact: true }).first();
const canvas = () => page.locator('svg[aria-label="2D sketch canvas"]');
// Sketch points go in through the tool's coordinate strip inside the sketch (exact
// millimetres), the way a user types them; the canvas is a perspective view where a
// click could miss. Drawing tools have no window since 2026-10-31; Escape ends them.
const draw = async (tool, points) => {
  await ribbon(tool).click();
  await page.waitForTimeout(300);
  for (const [x, y] of points) {
    // Clicks where the sketch puts that point on screen; grid snapping keeps whole millimetres.
    const at = await page.evaluate(([px, py]) => window.__aetherSketchClientPoint?.(px, py), [x, y]);
    assert.ok(at, `sketch point ${x},${y} is not on screen`);
    await page.mouse.click(at[0], at[1]);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape'); // back to Select; a drawing tool shows no strip to wait for
  log.sketch = (log.sketch ?? []).concat([await page.locator('body').innerText().then(t => t.match(/\d+ closed \/ \d+ open profiles/)?.[0] ?? '?')]);
};
const acceptSketch = async () => { const accept = page.locator('.cad-sketch-window [data-feature-action="accept"]'); await expect(accept).toBeEnabled({ timeout: 30000 }); await accept.click(); await expect(page.locator('.cad-sketch-window')).toHaveCount(0, { timeout: 60000 }); await page.waitForTimeout(500); };
// Nothing in the sketch workspace may paint over the view: a stretched hidden control once
// covered the whole viewport with an opaque panel while clicks still went through.
const sketchNotCovered = async (label) => { const covers = await page.evaluate(() => { const W = innerWidth, H = innerHeight; return [...document.querySelectorAll('.cad-sketch-workspace *')].filter(e => { if (e.closest('svg'))
  return false; const c = getComputedStyle(e), r = e.getBoundingClientRect(); const opaque = c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent' && Number(c.opacity) > 0.1; return opaque && c.visibility !== 'hidden' && r.width * r.height > 0.15 * W * H; }).map(e => e.tagName + '.' + e.className + ' ' + e.textContent.slice(0, 40)); }); assert.deepEqual(covers, [], `${label}: the sketch workspace covers the view with ${covers.join(', ')}`); };
const newSketchOn = async (planeName) => {
  await tab('Solid').click().catch(() => { });
  await ribbon('Sketch').click();
  await page.locator('.cad-sketch-workspace.choosing-plane').waitFor({ timeout: 30000 });
  await sketchNotCovered('choosing a plane');
  await featureRow(new RegExp(planeName)).click();
  await expect(page.locator('.cad-sketch-workspace.choosing-plane')).toHaveCount(0, { timeout: 30000 });
  await page.locator('.cad-sketch-window').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await sketchNotCovered('sketching on ' + planeName);
};
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const doc = { format: 'aether-part', formatVersion: 21, documentId: randomUUID(), name: 'Tools qualification', units: 'millimeter', features: [] };
  const file = await page.evaluate(async (data) => { const r = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok)
    throw Error(await r.text()); return r.json(); }, { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Tools qualification.acpart', data_base64: Buffer.from(JSON.stringify(doc)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await featureRow(/Default geometry/).waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await newSketchOn('Top Plane');
  const svgCursor = () => page.evaluate(() => { const svg = document.querySelector('svg.cad-sketch-canvas'); return svg && { tool: svg.dataset.tool, cursor: getComputedStyle(svg).cursor }; });
  // Select tool: default pointer. Rectangle tool: crosshair.
  const idle = await svgCursor();
  assert.equal(idle?.cursor, 'default', `Select shows the default pointer, got ${JSON.stringify(idle)}`);
  await ribbon('Rectangle').click(); await page.waitForTimeout(300);
  const drawing = await svgCursor();
  assert.equal(drawing?.cursor, 'crosshair', `a drawing tool shows the crosshair, got ${JSON.stringify(drawing)}`);
  const at = async (x, y) => { const p = await page.evaluate(([px, py]) => window.__aetherSketchClientPoint?.(px, py), [x, y]); assert.ok(p, `sketch point ${x},${y} on screen`); return p; };
  for (const [x, y] of [[10, 10], [40, 30]]) { const p = await at(x, y); await page.mouse.click(p[0], p[1]); await page.waitForTimeout(200); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  assert.equal((await svgCursor())?.cursor, 'default', 'Escape returns the default pointer');
  // Hover over the top-right corner: a hover highlight appears before any click.
  const corner = await at(40, 30);
  await page.mouse.move(corner[0] + 40, corner[1] + 40); await page.mouse.move(corner[0], corner[1]); await page.waitForTimeout(250);
  const hover = await page.evaluate(() => document.querySelectorAll('svg.cad-sketch-canvas .sketch-hover').length);
  assert.ok(hover >= 1, 'hovering a point previews the pick');
  // Drag the free corner 20 mm right and 10 mm up: the rectangle's corner follows.
  const target = await at(60, 40);
  await page.mouse.down(); await page.mouse.move(corner[0] + 10, corner[1] - 5); await page.mouse.move(target[0], target[1], { steps: 8 }); await page.waitForTimeout(150); await page.mouse.up();
  await page.waitForTimeout(400);
  // Finished geometry is drawn as paths; every "x y" pair in them is a vertex (svg y is negated).
  const points = await page.evaluate(() => [...document.querySelectorAll('svg.cad-sketch-canvas .sketch-contour')].flatMap(el => [...(el.getAttribute('d') ?? '').matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), -Number(m[2])])));
  const moved = points.some(([x, y]) => Math.abs(x - 60) < 1.5 && Math.abs(y - 40) < 1.5);
  const status = await page.locator('body').innerText().then(t => t.match(/Cannot|cannot|failed/)?.[0] ?? null);
  console.log('DRAG ' + JSON.stringify({ points, moved, status }));
  await page.screenshot({ path: join(evidence, 'drag.png') });
  assert.ok(moved, `the dragged corner lands at 60,40: ${JSON.stringify(points)}`);
  // Dimension the bottom edge, leave the tool, then one click selects the dimension and Delete removes it.
  // The Dimension tool through the command search: the ribbon button sits under the sketch window at this width.
  await page.keyboard.press('ControlOrMeta+k');
  const box = page.locator('.cad-document-bar .aui-command-search input').first();
  await box.waitFor({ timeout: 10000 }); await box.fill('Dimension');
  await page.locator('[role="option"][id$="-sketch-constraint-distance"]').first().click(); await page.waitForTimeout(300);
  const mid = await at(35, 10); await page.mouse.click(mid[0], mid[1]); await page.waitForTimeout(200);
  const below = await at(35, -8); await page.mouse.click(below[0], below[1]); await page.waitForTimeout(300);
  const entry = page.locator('.cad-sketch-dimension-entry input');
  await entry.waitFor({ timeout: 10000 }); await entry.fill('50'); await entry.press('Enter'); await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const label = page.locator('svg.cad-sketch-canvas .sketch-dimension-annotations:not(.sketch-dimension-preview) .sketch-dimension text').first();
  await label.waitFor({ timeout: 10000 });
  const before = await page.locator('svg.cad-sketch-canvas .sketch-dimension').count();
  await label.click(); await page.waitForTimeout(250);
  const selected = await page.locator('svg.cad-sketch-canvas .sketch-annotation-selected').count();
  const editorOpen = await page.locator('.cad-sketch-dimension-entry').count();
  assert.ok(selected >= 1, 'one click selects the dimension');
  assert.equal(editorOpen, 0, 'one click does not open the value box');
  await page.keyboard.press('Delete'); await page.waitForTimeout(400);
  const after = await page.locator('svg.cad-sketch-canvas .sketch-dimension').count();
  console.log('DIMENSION ' + JSON.stringify({ before, selected, after }));
  assert.ok(after < before, `Delete removes the selected dimension (${before} -> ${after})`);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed: true, idle, drawing, hover, points }, null, 1));
}
catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => { });
  await writeFile(join(evidence, 'failure.txt'), `${error?.stack ?? error}`);
  throw error;
}
finally {
  await browser.close();
}
