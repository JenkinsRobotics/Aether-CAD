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
const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const headed = process.env.AETHER_TIMING_HEADED === '1';
const browser = await chromium.launch({ headless: !headed, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
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
  await step('sketch-rectangle-on-top-plane', async () => {
    await newSketchOn('Top Plane');
    // Off the origin so the same profile can be revolved later.
    await draw('Rectangle', [[10, -15], [50, 15]]);
    await acceptSketch();
    await expect(featureRow(/^Sketch 1/)).toBeVisible({ timeout: 30000 });
  });
  await step('extrude-new', async () => {
    await tab('Solid').click().catch(() => { });
    await ribbon('Extrude').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Sketch', 'Sketch 1');
    await setInput('Distance (mm)', 12);
    await applyDialog('extrude-new');
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
    await expect(featureRow(/^Extrude \d/)).toBeVisible();
  });
  await step('sketch-on-face', async () => {
    // Sketch on the plate's top face: the viewport pick path (frame, anchor, source feature).
    await tab('Solid').click().catch(() => { });
    await ribbon('Sketch').click();
    await page.locator('.cad-sketch-workspace.choosing-plane').waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
    await expect(page.locator('.cad-sketch-workspace.choosing-plane')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('.cad-sketch-window')).toContainText(/Face of Extrude/, { timeout: 10000 });
    await page.locator('.cad-sketch-window').getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await expect(page.locator('.cad-sketch-window')).toHaveCount(0, { timeout: 10000 });
    await page.waitForTimeout(300);
  });
  await step('display-analysis', async () => {
    // Zebra and draft analysis are display styles: each gets a screenshot, then shaded + edges comes back.
    await tab('View').click().catch(() => { });
    const shadedBytes = await page.locator('canvas').first().screenshot();
    for (const [name, file, id] of [['Zebra analysis', 'zebra', 'display-zebra'], ['Draft analysis', 'draft', 'display-draft-analysis']]) {
      await ribbon(name, id).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(evidence, `analysis-${file}.png`) });
      assert.ok(await page.locator('canvas').first().isVisible(), `${name}: the viewport vanished`);
      const bytes = await page.locator('canvas').first().screenshot();
      assert.ok(!bytes.equals(shadedBytes), `${name}: the viewport did not change`);
    }
    await ribbon('Shaded with Edges').click();
    await page.waitForTimeout(300);
  });
  await step('sketch-circle-and-extrude-remove', async () => {
    await newSketchOn('Top Plane');
    await draw('Circle', [[30, 6], [34, 6]]); // clear of the X axis (revolved about later) and far enough from the sides for the 1.5 mm shell
    await acceptSketch();
    await expect(featureRow(/^Sketch 2/)).toBeVisible({ timeout: 30000 });
    await tab('Solid').click().catch(() => { });
    await ribbon('Extrude').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await page.locator('.cad-feature-dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await setSelect('Sketch', 'Sketch 2');
    await setInput('Distance (mm)', 5);
    // The sketch sits on the plate's bottom plane: a cut goes behind the sketch unless flipped.
    await setSelect('Flip direction', 'true');
    await applyDialog('extrude-remove');
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1);
  });
  await step('extrude-add-and-intersect', async () => {
    // Add: a 6 mm slab under the plate from its own outline (full-face contact merges; the
    // hole's circle would only touch the rim and is refused, as FreeCAD refuses it).
    // Intersect: a tall extrusion of the outline keeps the plate itself.
    await tab('Solid').click().catch(() => { });
    await ribbon('Extrude').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await page.locator('.cad-feature-dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await setSelect('Sketch', 'Sketch 1');
    await setInput('Distance (mm)', 6);
    await setSelect('Flip direction', 'true');
    await applyDialog('extrude-add');
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1);
    await ribbon('Extrude').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await page.locator('.cad-feature-dialog').getByRole('button', { name: 'Intersect', exact: true }).click();
    await setSelect('Sketch', 'Sketch 1');
    await setInput('Distance (mm)', 40);
    await applyDialog('extrude-intersect');
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1);
  });
  await step('revolve-new', async () => {
    await ribbon('Revolve').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await page.locator('.cad-feature-dialog').getByRole('button', { name: 'New', exact: true }).click().catch(() => { });
    await setSelect('Sketch', 'Sketch 1');
    await setSelect('Axis', 'Y').catch(() => { });
    await setInput('Angle (deg)', 90);
    await applyDialog('revolve-new');
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(2, { timeout: 30000 });
  });
  await step('fillet', async () => {
    await ribbon('Fillet').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Target body', 'Body 1').catch(() => { });
    await setSelect('Edges', 'all'); // Edges default to the picked set since 2026-10-31; this step rounds every edge.
    await setInput('All-edge size (mm)', 2); // larger than the shell wall, so the shell's inner fillets keep a radius
    // The radius manipulator the preview publishes shows in the viewport while the dialog is open.
    await expect(page.locator('.cad-extrusion-handle').first()).toBeVisible({ timeout: 15000 });
    await applyDialog('fillet');
    await expect(featureRow(/^Fillet/)).toBeVisible();
  });
  await step('shell', async () => {
    await ribbon('Shell').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Target body', 'Body 1').catch(() => { });
    await setInput('Thickness (mm)', 1.5);
    await applyDialog('shell');
    await expect(featureRow(/^Shell/)).toBeVisible();
  });
  await step('mirror-add', async () => {
    await ribbon('Mirror', 'feature-mirror').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Feature', /^Extrude/);
    await setSelect('Mirror plane', 'YZ').catch(() => { });
    await setSelect('Operation', 'add').catch(() => { });
    await setSelect('Target body', 'Body 1').catch(() => { });
    await applyDialog('mirror-add');
    await expect(featureRow(/^Mirror/)).toBeVisible();
  });
  await step('pattern-linear', async () => {
    await ribbon('Pattern', 'feature-pattern').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Source feature', /^Extrude/).catch(() => { });
    await setSelect('Pattern type', 'linear').catch(() => { });
    await setSelect('Axis', 'X').catch(() => { });
    await setInput('Occurrences', 3);
    await setInput('Spacing (mm)', 40);
    await setSelect('Target body', 'Body 1').catch(() => { });
    await applyDialog('pattern-linear');
    await expect(featureRow(/^Pattern/)).toBeVisible();
  });
  await step('boolean-union', async () => {
    await ribbon('Boolean', 'feature-boolean').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Operation', 'union').catch(() => { });
    await setSelect('Target body', 'Body 1').catch(() => { });
    // Tool bodies are ids; the Target body select lists every body by name with its id as value.
    const toolId = await page.locator('.cad-feature-dialog [aria-label="Target body"]').evaluate(el => [...el.options].find(o => o.textContent.trim() === 'Body 2')?.value);
    assert.ok(toolId, 'a second body to use as the boolean tool');
    await setInput('Tool body IDs', JSON.stringify([toolId]));
    await applyDialog('boolean-union');
    await expect(featureRow(/^Boolean/)).toBeVisible();
  });
  const saveFixture = async (name, count) => {
    let content;
    await expect.poll(async () => {
      const stored = await page.evaluate(async (id) => { const r = await fetch('/api/library/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', id }) }); if (!r.ok)
        throw Error(await r.text()); return r.json(); }, file.id);
      content = Buffer.from(stored.data_base64, 'base64').toString('utf8');
      return JSON.parse(content).features.length;
    }, { timeout: 30000 }).toBe(count);
    await writeFile(join(evidence, name), content);
  };
  await saveFixture('before-hole.acpart', 12);
  await step('hole', async () => {
    await ribbon('Hole', 'feature-hole').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Sketch', 'Sketch 2').catch(async () => { await setSelect('Center sketch', 'Sketch 2'); });
    await setInput('Diameter (mm)', 4);
    await setInput('Depth (mm)', 6);
    await setSelect('Target body', 'Body 1').catch(() => { });
    // Explicitly set drill direction after the source and dimensions so this
    // preview represents the final authored parameters. The prior revolve/union
    // puts material on both sides of this plane.
    await setSelect('Direction', 'normal');
    await applyDialog('hole');
    await expect(featureRow(/^Hole/)).toBeVisible();
    await saveFixture('with-hole.acpart', 13);
  });
  // Last: a 360° revolve cut leaves toroidal faces that OCCT (FreeCAD too) cannot shell or fillet.
  await step('revolve-remove', async () => {
    await ribbon('Revolve').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await page.locator('.cad-feature-dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await setSelect('Sketch', 'Sketch 2');
    await setSelect('Axis', 'X').catch(() => { });
    await setInput('Angle (deg)', 180);
    await setSelect('Target body', 'Body 1').catch(() => { });
    await applyDialog('revolve-remove');
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1); // the boolean union already merged the two bodies
  });
  await step('surface-sheet-and-thicken', async () => {
    // A sheet from the plate outline (no caps), then thickened into a new solid: two more parts.
    const before = await page.locator('.cad-parts-list').getByRole('treeitem').count();
    await tab('Surface').click();
    await ribbon('Extrude', 'feature-surface-extrude').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Sketch curves', 'Sketch 1');
    await setInput('Distance (mm)', 8);
    await applyDialog('surface-extrude');
    await expect(featureRow(/^Surface Extrude/)).toBeVisible();
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(before + 1);
    await ribbon('Thicken', 'feature-surface-thicken').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    const sheet = await page.locator('.cad-feature-dialog [aria-label="Body"]').evaluate(el => [...el.options].map(o => o.textContent.trim()).pop());
    await setSelect('Body', sheet);
    await page.locator('.cad-feature-dialog').getByRole('button', { name: 'Add body', exact: true }).click();
    await setInput('Thickness (mm)', 1);
    await applyDialog('surface-thicken');
    await expect(featureRow(/^Surface Thicken/)).toBeVisible();
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(before + 2);
    await tab('Solid').click().catch(() => { });
  });
  await step('sheet-metal-base-and-flat-dxf', async () => {
    // A sheet metal plate from the plate outline with its rule; the flat pattern command answers.
    const before = await page.locator('.cad-parts-list').getByRole('treeitem').count();
    await tab('Sheet Metal').click();
    await ribbon('Sheet metal model', 'feature-sheet-base').click();
    await page.locator('.cad-feature-dialog').waitFor({ timeout: 30000 });
    await setSelect('Sketch', 'Sketch 1');
    await setInput('Thickness (mm)', 2);
    await applyDialog('sheet-base');
    await expect(featureRow(/^Sheet Base/)).toBeVisible();
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(before + 1);
    await ribbon('Flat pattern DXF', 'sheet-export-flat-dxf').click();
    await page.waitForTimeout(1500);
    await tab('Solid').click().catch(() => { });
  });
  await step('sketch-3d', async () => {
    // 3D Sketch is the Sketch button's variant: a strip over the viewport, points typed or clicked.
    await page.getByRole('button', { name: 'Sketch variants' }).click();
    await page.locator('.aui-tool-menu').getByText('3D Sketch', { exact: true }).click();
    const strip = page.locator('.cad-sketch3d-strip');
    await strip.waitFor({ timeout: 15000 });
    for (const point of ['0 0 30', '40 0 30', '40 40 50']) {
      await strip.getByLabel('Point x y z').fill(point);
      await strip.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await strip.getByRole('button', { name: 'Done' }).click();
    await expect(featureRow(/^3D Sketch 1/)).toBeVisible({ timeout: 30000 });
    await expect(strip).toHaveCount(0);
    // Reopening the feature brings the strip back with its points.
    // A row's context menu carries Edit…, as the panel-context gate drives it.
    await featureRow(/^3D Sketch 1/).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit…', exact: true }).click();
    await strip.waitFor({ timeout: 15000 });
    await expect(strip.getByRole('status')).toContainText('3 points');
    await strip.getByRole('button', { name: 'Cancel' }).click();
  });
  await writeFile(join(evidence, 'log.json'), JSON.stringify({ steps, errors, log }, null, 1));
  const real = errors.filter(e => !/favicon|ResizeObserver/.test(e));
  assert.deepEqual(real, [], 'page errors: ' + real.join(' | '));
  assert.equal(geometryRequests, 0, 'Geometry must stay in the product runtime');
  console.log('TOOLS ' + JSON.stringify({ steps, engine: log.engine, failed: log.failed }));
}
catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => { });
  await writeFile(join(evidence, 'failure.txt'), `${error?.stack ?? error}\n${JSON.stringify({ steps, errors, log })}`);
  throw error;
}
finally {
  await browser.close();
}
