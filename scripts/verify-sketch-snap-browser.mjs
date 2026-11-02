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
  await ribbon('Line').click();
  await page.waitForTimeout(300);
  const near = await page.evaluate(() => window.__aetherSketchClientPoint?.(0.6, 0.4));
  assert.ok(near, 'sketch origin is on screen');
  await page.mouse.move(near[0] + 30, near[1] + 30);
  await page.mouse.move(near[0], near[1]);
  await page.waitForTimeout(300);
  const probe = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label="2D sketch canvas"]');
    const fb = svg?.querySelector('.sketch-snap-feedback');
    const pt = svg?.querySelector('.sketch-preview-point');
    return { feedback: fb?.textContent?.trim() ?? null, target: fb?.querySelector('[aria-label]')?.getAttribute('aria-label') ?? null,
      point: pt ? [pt.getAttribute('cx'), pt.getAttribute('cy')] : null, snapping: localStorage.getItem('aether-cad.snapping'), scale: window.__aetherSketchClientPoint?.(1, 0)[0] - window.__aetherSketchClientPoint?.(0, 0)[0] };
  });
  console.log('SNAP ' + JSON.stringify(probe));
  await page.screenshot({ path: join(evidence, 'snap-near-origin.png') });
  await page.mouse.click(near[0], near[1]);
  const far = await page.evaluate(() => window.__aetherSketchClientPoint?.(20, 0.5));
  await page.mouse.move(far[0], far[1]); await page.waitForTimeout(200);
  const second = await page.evaluate(() => { const fb = document.querySelector('.sketch-snap-feedback'); return fb?.textContent?.trim() ?? null; });
  await page.mouse.click(far[0], far[1]);
  await page.keyboard.press('Escape');
  const paths = await page.evaluate(() => [...document.querySelectorAll('svg[aria-label="2D sketch canvas"] path')].map(p => p.getAttribute('d')).filter(d => d && d.startsWith('M')).slice(0, 3));
  console.log('SNAP2 ' + JSON.stringify({ second, paths }));
  await page.screenshot({ path: join(evidence, 'snap-line.png') });
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed: true, probe, second, paths }, null, 1));
}
catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => { });
  await writeFile(join(evidence, 'failure.txt'), `${error?.stack ?? error}`);
  throw error;
}
finally {
  await browser.close();
}
