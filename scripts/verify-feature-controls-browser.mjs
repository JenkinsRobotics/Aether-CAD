// Real native documents and actual UI interaction on the disposable Studio host.
import assert from 'node:assert/strict';
import { verifySurfaceAdd } from './browser/surface-add-workflow.mjs';
import { verifyObliqueDraft } from './browser/oblique-draft-workflow.mjs';
import { verifyExtrudeProfileFocus } from './browser/extrude-profile-focus.mjs';
import { verifyExtrudeModeRemoval, verifyConnectedProfileModes } from './browser/extrude-mode-selection.mjs';
import { verifyExtrudeDirection } from './browser/extrude-direction-workflow.mjs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE)('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const engine = process.env.AETHER_GATE_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, ...(engine === chromium ? { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => document.addEventListener('aether-feature-preview-state', event => {
  window.__qualificationPreview = event.detail.pending ? null : event.detail.model;
}));
const dialog = () => page.locator('.cad-feature-dialog');
const row = name => page.getByRole('treeitem', { name }).first();
const point = p => page.evaluate(p => window.__aetherClientPoint?.(...p), p);
const open = async document => {
  const file = await page.evaluate(async data => {
    const response = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: document.name + '.aethercad', data_base64: partDocumentBase64(document) });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await row(new RegExp(document.features.at(-1).name)).waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200); return file;
};
const stored = async id => {
  const data = await page.evaluate(async id => {
    const response = await fetch('/api/library/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', id }) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, id);
  return tabDocumentOf(data.data_base64);
};
const accept = async () => {
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  await dialog().locator('[data-feature-action="accept"]').click();
  await expect(dialog()).toHaveCount(0); await page.waitForTimeout(500);
};
const command = async (name, id) => {
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.locator('.cad-document-bar .aui-command-search input').first();
  await search.fill(name); await page.locator(`[role="option"][id$="-${id}"]`).first().click();
  await expect(dialog()).toBeVisible();
};
const base = name => ({ format: 'aether-part', formatVersion: 22, documentId: randomUUID(), name, units: 'millimeter', features: [] });
const sketch = (id, plane, points) => ({ id, type: 'profile', name: 'Sketch 1', plane, offsetMillimeters: 0, suppressed: false,
  profile: { type: 'drawing', contours: [{ type: 'path', id: 'outline', start: points[0], segments: [...points.slice(1), points[0]].map((end, i) => ({ id: `edge-${i}`, type: 'line', end })) }] } });
try {
  await page.goto(origin + '/cad/');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible({ timeout: 30000 });
  await page.waitForLoadState('networkidle');
  if (!process.env.AETHER_EXTRUDE_DIRECTION_ONLY) {
  const extrude = base('Native extrusion controls');
  extrude.features = [sketch('s', 'XY', [[0, 0], [20, 0], [20, 10], [0, 10]]), {
    id: 'e', type: 'extrude', name: 'Extrude 1', suppressed: false, profileFeatureId: 's', operation: 'new',
    distanceMillimeters: 10, directionVector: [.6, 0, .8], startingOffsetMillimeters: 5,
    secondEnd: { endType: 'blind', distanceMillimeters: 4 },
  }];
  const extrusionFile = await open(extrude);
  await row(/^Extrude 1/).dblclick();
  const primary = page.getByRole('button', { name: 'Pull extrusion depth', exact: true });
  await expect(primary).toBeEnabled({ timeout: 45000 });
  const expected = await point([19, 5, 12]), box = await primary.boundingBox();
  assert.ok(Math.hypot(box.x + box.width / 2 - expected[0], box.y + box.height / 2 - expected[1]) < 2, 'depth handle follows shifted oblique native extrusion');
  const opposite = page.getByRole('button', { name: 'Pull opposite extrusion depth', exact: true });
  await opposite.press('ArrowUp');
  await expect(dialog().locator('[aria-label="Opposite depth (mm)"]')).toHaveValue('5');
  const input = page.locator('.aui-manipulator-readout[aria-label="Pull opposite extrusion depth"]');
  await expect(input).toBeEnabled({ timeout: 45000 }); await input.fill('0.5 in'); await input.press('Enter');
  await expect(dialog().locator('[aria-label="Opposite depth (mm)"]')).toHaveValue('12.7');
  assert.equal(Number(await dialog().locator('[aria-label="Distance (mm)"]').inputValue()), 10);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  await expect.poll(() => page.evaluate(() => {
    const model = window.__qualificationPreview; if (!model) return null;
    let z = Infinity; for (const part of (model.featurePreview?.added ?? model.parts)) for (let i=2;i<part.vertices.length;i+=3) z=Math.min(z,part.vertices[i]);
    return Number(z.toFixed(3));
  }), { timeout: 45000 }).toBe(-6.16);
  await page.screenshot({ path: join(evidence, 'extrude-shared-controls.png') });
  await accept();
  await expect.poll(async () => (await stored(extrusionFile.id)).features.at(-1).secondEnd.distanceMillimeters, { timeout: 30000 }).toBe(12.7);
  await page.reload(); await row(/^Extrude 1/).dblclick();
  assert.equal(Number(await dialog().locator('[aria-label="Opposite depth (mm)"]').inputValue()), 12.7);
  await dialog().locator('[data-feature-action="discard"]').click();
  results.push('Extrude: native anchor, secondary readout, explicit units, save and reopen');

  for (const mode of ['Solid', 'Thin', 'Surface']) {
    const multiple = base('Multiple sketch ' + mode);
    multiple.features = [-12, 12].map((x, index) => ({ id: index ? 'b' : 'a', type: 'profile', name: 'Sketch ' + (index + 1), plane: 'XY', offsetMillimeters: index * 3, suppressed: false,
      profile: { type: 'drawing', contours: [{ id: 'same-name', type: 'circle', center: [x, 0], radius: 4 }] } }));
    const file = await open(multiple);
    await page.evaluate(() => window.__aetherSetView('top'));
    await command('Extrude', 'feature-extrude');
    await dialog().getByRole('button', { name: mode, exact: true }).click();
    const entities = dialog().locator('.aui-feature-entities').first();
    while (await entities.getByRole('button', { name: /^Remove / }).count())
      await entities.getByRole('button', { name: /^Remove / }).first().click();
    if (mode === 'Solid') {
      for (const p of [[-12, 0, 0], [12, 0, 3]]) { const at = await point(p); assert.ok(at); await page.mouse.click(...at); }
    } else {
      await row(/^Sketch 1/).click();
      await row(/^Sketch 2/).click();
    }
    await expect(entities.locator('.aui-feature-entity')).toHaveCount(2);
    await expect(dialog().locator('select[aria-label="Sketch"]')).toBeHidden();
    await expect(dialog().locator('select[aria-label="Sketch curves"], select[aria-label="Region"]')).toBeHidden();
    // Keep the exact end-on view that previously made every depth control disappear.
    const depthHandle = page.getByRole('button', { name: 'Pull extrusion depth', exact: true });
    await expect(depthHandle).toBeEnabled({ timeout: 45000 });
    await expect(depthHandle).toHaveAttribute('data-axis-view', 'toward');
    await depthHandle.press('ArrowUp');
    await expect(depthHandle).toBeEnabled({ timeout: 45000 });
    const grab = await depthHandle.boundingBox();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2); await page.mouse.down();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2 - 35, { steps: 5 });
    await expect.poll(async () => Number(await dialog().locator('[aria-label="Distance (mm)"]').inputValue())).toBeGreaterThan(11);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(dialog().locator('[aria-label="Distance (mm)"]')).toHaveValue('11');
    await expect.poll(() => page.evaluate(() => {
      const model = window.__qualificationPreview; if (!model) return null;
      let z = -Infinity; for (const part of model.featurePreview?.added ?? model.parts) for (let i=2;i<part.vertices.length;i+=3) z=Math.max(z,part.vertices[i]);
      return Number(z.toFixed(3));
    }), { timeout: 45000 }).toBe(14);
    await page.screenshot({ path: join(evidence, `extrude-end-on-${mode.toLowerCase()}.png`) });
    await page.evaluate(() => window.__aetherSetView('bottom'));
    await expect(depthHandle).toHaveAttribute('data-axis-view', 'away');
    await depthHandle.press('ArrowDown');
    await expect(dialog().locator('[aria-label="Distance (mm)"]')).toHaveValue('10');
    await expect(depthHandle).toBeEnabled({ timeout: 45000 });
    await depthHandle.press('ArrowUp');
    await expect(dialog().locator('[aria-label="Distance (mm)"]')).toHaveValue('11');
    await page.evaluate(() => window.__aetherSetView('isometric'));
    await expect(depthHandle).toHaveAttribute('data-axis-view', '');
    await accept();
    await expect.poll(async () => (await stored(file.id)).features.at(-1).profileSelections?.length, { timeout: 30000 }).toBe(2);
    const original = (await stored(file.id)).features.at(-1);
    assert.equal(original.distanceMillimeters, 11);
    assert.equal(original.bodyOutputs.length, 2);
    await page.waitForLoadState('networkidle'); await page.reload();
    await row(/^Extrude/).dblclick();
    await expect(entities.locator('.aui-feature-entity')).toHaveCount(2);
    await entities.getByRole('button', { name: /^Remove / }).first().click();
    await expect(entities.locator('.aui-feature-entity')).toHaveCount(1);
    await accept();
    await expect.poll(async () => (await stored(file.id)).features.at(-1).profileSelections?.length, { timeout: 30000 }).toBe(1);
    const remaining = (await stored(file.id)).features.at(-1);
    assert.equal(remaining.profileSelections[0].profileFeatureId, 'b');
    {
      assert.equal(remaining.outputProfileId, 'a');
      assert.equal(remaining.bodyOutputs.length, 1);
      assert.ok(original.bodyOutputs.includes(remaining.bodyOutputs[0]));
    }
    await page.screenshot({ path: join(evidence, `extrude-multiple-${mode.toLowerCase()}.png`) });
    results.push(mode + ' Extrude: two real sketch selections, common depth preview, saved reopen, primary selection removal and retained output identity');
  }

  const whole = base('Whole sketch Surface outputs');
  whole.features = [{ id: 'whole', type: 'profile', name: 'Two open curves', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [0, 10, 20].map((x, index) => ({ id: `curve-${index}`, type: 'path', start: [x, 0],
      segments: [{ type: 'line', end: [x + 5, 0] }], ...(index === 2 ? { construction: true } : {}) })) } }];
  const wholeFile = await open(whole);
  await row(/^Two open curves/).click();
  await command('Extrude', 'feature-extrude');
  await dialog().getByRole('button', { name: 'Surface', exact: true }).click();
  const wholeEntities = dialog().locator('[aria-label="Sketch curves to extrude"]');
  await expect(wholeEntities.locator('.aui-feature-entity')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.__qualificationPreview?.bodyOutputs ? Object.values(window.__qualificationPreview.bodyOutputs)[0]?.length : 0), { timeout: 45000 }).toBe(2);
  await verifyExtrudeModeRemoval({page, expect, dialog, row, results});
  await accept();
  await expect.poll(async () => (await stored(wholeFile.id)).features.at(-1).bodyOutputs?.length, { timeout: 30000 }).toBe(2);
  const wholeSaved = (await stored(wholeFile.id)).features.at(-1);
  await page.reload(); await row(/^Extrude/).dblclick();
  await expect(wholeEntities.locator('.aui-feature-entity')).toHaveCount(2);
  await wholeEntities.getByRole('button', { name: /^Remove / }).first().click();
  await expect(wholeEntities.locator('.aui-feature-entity')).toHaveCount(1);
  await accept();
  await expect.poll(async () => (await stored(wholeFile.id)).features.at(-1).bodyOutputs?.length, { timeout: 30000 }).toBe(1);
  const wholeRemaining = (await stored(wholeFile.id)).features.at(-1);
  assert.ok(wholeSaved.bodyOutputs.includes(wholeRemaining.bodyOutputs[0]));
  assert.equal(wholeRemaining.profileSelections[0].profileContourId, 'curve-1');
  results.push('Surface whole-sketch preselection: two independent native sheets, construction excluded, saved reopen, curve removal and retained body identity');
  await verifyConnectedProfileModes({page, expect, dialog, row, open, stored, accept, command, base, results});

  const surface = { ...base('Native Surface extrusion controls'), formatVersion: 23 };
  surface.features = [{ id: 's', type: 'profile', name: 'Surface sketch', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [{ id: 'line', type: 'path', start: [-5, 0], segments: [{ type: 'line', end: [5, 0] }] }] } }];
  const surfaceFile = await open(surface);
  await command('Extrude', 'feature-extrude');
  await dialog().getByRole('button', { name: 'Surface', exact: true }).click();
  await row(/^Surface sketch/).click();
  await expect(dialog().getByRole('button', { name: 'Remove', exact: true })).toBeHidden();
  await expect(dialog().getByRole('button', { name: 'Intersect', exact: true })).toBeHidden();
  const surfaceDepth = page.getByRole('button', { name: 'Pull extrusion depth', exact: true });
  await expect(surfaceDepth).toBeEnabled({ timeout: 45000 });
  await surfaceDepth.press('ArrowUp');
  await expect(dialog().locator('[aria-label="Distance (mm)"]')).toHaveValue('11');
  await expect.poll(() => page.evaluate(() => {
    const model = window.__qualificationPreview; if (!model) return null;
    let z = -Infinity; for (const part of (model.featurePreview?.added ?? model.parts)) for (let i=2;i<part.vertices.length;i+=3) z=Math.max(z,part.vertices[i]);
    return Number(z.toFixed(3));
  }), { timeout: 45000 }).toBe(11);
  await page.screenshot({ path: join(evidence, 'surface-shared-extrusion-controls.png') });
  await accept();
  await expect.poll(async () => (await stored(surfaceFile.id)).features.at(-1).type).toBe('surface-extrude');
  const surfaceSaved = (await stored(surfaceFile.id)).features.at(-1);
  assert.equal(surfaceSaved.distanceMillimeters, 11);
  assert.equal(surfaceSaved.profileSelections[0].profileContourId, 'line');
  assert.equal(surfaceSaved.thin, undefined);
  await page.reload(); await row(/^Extrude /).dblclick();
  await expect(dialog().locator('[aria-label="Creation type"]')).toHaveValue('surface');
  await expect(surfaceDepth).toBeEnabled({ timeout: 45000 });
  const curves = dialog().locator('.aui-feature-entities[aria-label="Sketch curves to extrude"]');
  await curves.getByRole('button', { name: /^Remove / }).click();
  await expect(curves.locator('.aui-feature-entity')).toHaveCount(0);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual((await stored(surfaceFile.id)).features.at(-1), surfaceSaved);
  results.push('Surface Extrude: shared Solid/Surface/Thin tabs, open curve, real native sheet preview, shared axis control, editable save/reopen, × removal and cancel');

  await verifySurfaceAdd({page, expect, dialog, row, open, stored, accept, command, base, evidence, results});

  const thin = base('Native thin draft controls');
  thin.features = [sketch('s', 'XY', [[0, 0], [20, 0], [20, 10], [0, 10]]), {
    id: 'e', type: 'extrude', name: 'Extrude 1', suppressed: false, profileFeatureId: 's', profileContourId: 'outline', operation: 'new',
    distanceMillimeters: 10, draftAngleDegrees: 3, thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 },
  }];
  const thinFile = await open(thin);
  await page.evaluate(() => window.__aetherSetView?.('isometric')); await row(/^Extrude 1/).dblclick();
  const draftRing = page.getByRole('button', { name: 'Draft angle', exact: true });
  await draftRing.focus(); await expect(draftRing).toHaveAttribute('aria-disabled', 'false', { timeout: 45000 });
  await draftRing.press('ArrowUp');
  await expect(dialog().locator('[aria-label^="Draft angle ("]')).toHaveValue('4');
  const thickness = page.getByRole('button', { name: 'Wall thickness 1', exact: true });
  await thickness.focus(); await expect(thickness).toBeEnabled({ timeout: 45000 }); await thickness.press('ArrowUp');
  await expect(dialog().locator('[aria-label="Thickness 1 (mm)"]')).toHaveValue('3');
  const inside = page.getByRole('button', { name: 'Wall thickness 2', exact: true });
  await inside.focus(); await expect(inside).toBeEnabled({ timeout: 45000 }); await inside.press('ArrowDown');
  await expect(dialog().locator('[aria-label="Thickness 2 (mm)"]')).toHaveValue('0');
  const wallReadout = page.locator('.aui-manipulator-readout[aria-label="Wall thickness 2"]');
  await expect(wallReadout).toBeEnabled({ timeout: 45000 });
  await wallReadout.fill('-1 mm'); await wallReadout.press('Enter');
  await expect(dialog().locator('[aria-label="Thickness 2 (mm)"]')).toHaveValue('0');
  await wallReadout.fill('0 mm'); await wallReadout.press('Enter');
  await expect.poll(() => page.evaluate(() => {
    const model = window.__qualificationPreview; if (!model) return null;
    let y = Infinity;
    for (const part of (model.featurePreview?.added ?? model.parts)) for (let i=0;i<part.vertices.length;i+=3) {
      if (Math.abs(part.vertices[i+2] - 10) < .00001) y=Math.min(y,part.vertices[i+1]);
    }
    return Number(y.toFixed(4));
  }), { timeout: 45000 }).toBe(Number((-3 + 10 * Math.tan(4 * Math.PI / 180)).toFixed(4)));
  await page.screenshot({ path: join(evidence, 'extrude-thin-draft-controls.png') });
  await accept();
  await expect.poll(async () => (await stored(thinFile.id)).features.at(-1).thin.thickness1Millimeters, { timeout: 30000 }).toBe(3);
  await page.reload(); await row(/^Extrude 1/).dblclick();
  await expect.poll(async () => Number(await dialog().locator('[aria-label^="Draft angle ("]').inputValue())).toBe(4);
  await expect.poll(async () => Number(await dialog().locator('[aria-label="Thickness 2 (mm)"]').inputValue())).toBe(0);
  await dialog().locator('[data-feature-action="discard"]').click();
  results.push('Extrude Thin: real draft, shared angle/thickness controls, zero and negative validation, native taper and saved reopen');
  await verifyObliqueDraft({ page, expect, dialog, row, open, stored, accept, base, sketch, evidence, results });

  const stopped = base('Native drafted stopping controls');
  stopped.features = [
    { ...sketch('limitSketch', 'XY', [[-5, -5], [25, -5], [25, 15], [-5, 15]]), name: 'Limit sketch', offsetMillimeters: 10 },
    { id: 'limit', type: 'extrude', name: 'Limit', suppressed: false, profileFeatureId: 'limitSketch', operation: 'new', bodyId: 'limitBody', distanceMillimeters: 5 },
    sketch('s', 'XY', [[0, 0], [20, 0], [20, 10], [0, 10]]),
    { id: 'e', type: 'extrude', name: 'Extrude 1', suppressed: false, profileFeatureId: 's', operation: 'new', distanceMillimeters: 1,
      draftAngleDegrees: 3, endType: 'up-to-face', endReference: { sourceFeatureId: 'limit', bodyId: 'limitBody', normal: [0, 0, -1], label: 'Stopping face' } },
  ];
  const stoppedFile = await open(stopped);
  await page.evaluate(() => window.__aetherSetView?.('isometric')); await row(/^Extrude 1/).dblclick();
  await verifyExtrudeProfileFocus({ page, expect, dialog, row, point, evidence, results });
  const stopHandle = page.getByRole('button', { name: 'End offset', exact: true });
  await expect(stopHandle).toBeEnabled({ timeout: 45000 }); await stopHandle.press('ArrowUp');
  await expect(dialog().locator('[aria-label="End offset (mm)"]')).toHaveValue('1');
  const stopReadout = page.locator('.aui-manipulator-readout[aria-label="End offset"]');
  await expect(stopReadout).toBeEnabled({ timeout: 45000 }); await stopReadout.fill('-2 mm'); await stopReadout.press('Enter');
  await expect(dialog().locator('[aria-label="End offset (mm)"]')).toHaveValue('-2');
  await expect.poll(() => page.evaluate(() => {
    const model = window.__qualificationPreview; if (!model) return null;
    let z = -Infinity;
    for (const part of (model.featurePreview?.added ?? [])) for (let i=2;i<part.vertices.length;i+=3) z=Math.max(z,part.vertices[i]);
    return Number(z.toFixed(3));
  }), { timeout: 45000 }).toBe(12);
  await page.screenshot({ path: join(evidence, 'extrude-drafted-stop-controls.png') });
  await accept();
  await expect.poll(async () => (await stored(stoppedFile.id)).features.at(-1).endOffsetMillimeters, { timeout: 30000 }).toBe(-2);
  await page.reload(); await row(/^Extrude 1/).dblclick();
  await expect.poll(async () => Number(await dialog().locator('[aria-label="End offset (mm)"]').inputValue())).toBe(-2);
  await expect(stopHandle).toBeEnabled({ timeout: 45000 }); await stopHandle.press('ArrowUp');
  await expect(dialog().locator('[aria-label="End offset (mm)"]')).toHaveValue('-1');
  await dialog().locator('[data-feature-action="discard"]').click();
  assert.equal((await stored(stoppedFile.id)).features.at(-1).endOffsetMillimeters, -2);
  results.push('Extrude: drafted parallel face stop, shared signed end-offset control, native extent, cancel and saved reopen');

  for (const endType of ['up-to-next', 'up-to-part']) {
    const narrowed = base(`Drafted ${endType} controls`);
    narrowed.features = [
      { ...sketch('limitSketch', 'XY', [[1, 1], [19, 1], [19, 9], [1, 9]]), name: 'Limit sketch', offsetMillimeters: 10 },
      { id: 'limit', type: 'extrude', name: 'Limit', suppressed: false, profileFeatureId: 'limitSketch', operation: 'new', bodyId: 'limitBody', distanceMillimeters: 100 },
      sketch('s', 'XY', [[0, 0], [20, 0], [20, 10], [0, 10]]),
      { id: 'e', type: 'extrude', name: 'Extrude 1', suppressed: false, profileFeatureId: 's', operation: 'new', bodyId: 'output', distanceMillimeters: 1,
        draftAngleDegrees: 10, endType, ...(endType === 'up-to-part' ? { endPartId: 'limitBody' } : {}) },
    ];
    const file = await open(narrowed); await row(/^Extrude 1/).dblclick();
    const offset = dialog().locator('[aria-label="End offset (mm)"]');
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
    if (endType === 'up-to-part') {
      const parts = dialog().locator('.aui-feature-entities[aria-label="Stopping part"]');
      await parts.getByRole('button', { name: /^Remove / }).click();
      await expect(parts.locator('.aui-feature-entity')).toHaveCount(0);
      const at = await point([10, 5, 110]);
      assert.ok(at);
      assert.equal(await page.evaluate(p => document.elementFromPoint(...p)?.matches('canvas.viewport-canvas'), at), true);
      await page.mouse.click(...at);
      await expect(dialog().locator('input[aria-label="Stopping part identity"]')).toHaveValue('limitBody');
      await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
    }
    // Keyboard interaction uses the same shared manipulator and canonical
    // draft as typing, even when the original profile exceeds the stop width.
    await expect(stopHandle).toBeEnabled({ timeout: 45000 }); await stopHandle.press('ArrowUp');
    await expect(offset).toHaveValue('1');
    await expect.poll(() => page.evaluate(() => {
      const preview = window.__qualificationPreview;
      const part = preview?.featurePreview?.added?.find(part => part.bodyId === 'output') ?? preview?.featurePreview?.added?.[0];
      if (!part) return null;
      const points = []; for (let i = 0; i < part.vertices.length; i += 3) points.push(part.vertices.slice(i, i + 3));
      const top = Math.max(...points.map(p => p[2]));
      return [Number(top.toFixed(4)), Number(Math.min(...points.filter(p => Math.abs(p[2] - top) < 1e-4).map(p => p[0])).toFixed(4))];
    }), { timeout: 45000 }).toEqual([9, Number((9 * Math.tan(10 * Math.PI / 180)).toFixed(4))]);
    // A real reversal is refused when the part is behind the profile; toggling
    // back restores the same selected stop and its valid geometry.
    const flip = dialog().getByRole('button', { name: 'Reverse extrusion direction', exact: true });
    await flip.click(); await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
    await flip.click(); await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
    await page.screenshot({ path: join(evidence, `extrude-${endType}-reference-layout.png`) });
    await accept();
    await expect.poll(async () => (await stored(file.id)).features.at(-1).endOffsetMillimeters, { timeout: 30000 }).toBe(1);
    await page.reload(); await row(/^Extrude 1/).dblclick();
    await expect.poll(async () => Number(await offset.inputValue())).toBe(1);
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
    await dialog().locator('[data-feature-action="discard"]').click();
    results.push(`Extrude ${endType}: smaller finite stop, distant back face, native taper, shared offset handle, reversal recovery and saved reopen`);
  }

  const shaft = () => {
    const doc = base('Stepped native shaft');
    doc.features = [sketch('s', 'XZ', [[10, 0], [20, 0], [20, 10], [15, 10], [15, 25], [10, 25]]),
      { id: 'r', type: 'revolve', name: 'Revolve 1', suppressed: false, profileFeatureId: 's', axis: 'Z', angleDegrees: 90, operation: 'new' }];
    return doc;
  };
  await open(shaft()); await row(/^Revolve 1/).dblclick();
  const ring = page.locator('.aui-manipulator-orbit-hit').first();
  await expect(ring).toHaveAttribute('aria-disabled', 'false', { timeout: 45000 });
  await ring.press('ArrowUp'); await expect(dialog().locator('[aria-label^="Angle ("]')).toHaveValue('105');
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  await expect.poll(() => page.evaluate(() => {
    const model = window.__qualificationPreview; if (!model) return null;
    let x = Infinity; for (const part of (model.featurePreview?.added ?? model.parts)) for (let i=0;i<part.vertices.length;i+=3) x=Math.min(x,part.vertices[i]);
    return Number(x.toFixed(3));
  }), { timeout: 45000 }).toBe(-5.176);
  await page.screenshot({ path: join(evidence, 'revolve-shared-orbit.png') });
  await dialog().locator('[data-feature-action="discard"]').click();
  results.push('Revolve: shared angular ribbon, live native preview and cancellation');

  for (const [name, id, field] of [['Chamfer', 'feature-chamfer', 'Distance (mm)'], ['Fillet', 'feature-fillet', 'Radius (mm)']]) {
    const file = await open(shaft());
    await page.evaluate(() => window.__aetherSetView?.('isometric')); await page.waitForTimeout(800);
    await command(name, id);
    const pick = async () => {
      const bounds = await dialog().boundingBox();
      for (const degrees of [45, 60, 30, 75, 15]) {
        const a = degrees * Math.PI / 180, p = await point([15.15 * Math.cos(a), 15.15 * Math.sin(a), 10]);
        if (!p || p[0] < 250 || (p[0] >= bounds.x - 10 && p[0] <= bounds.x + bounds.width + 10 && p[1] >= bounds.y - 10 && p[1] <= bounds.y + bounds.height + 10)) continue;
        await page.mouse.move(...p); await page.mouse.click(...p); return;
      }
      throw Error('Shoulder is obscured by the feature dialog');
    };
    await pick();
    const entities = dialog().locator(`.aui-feature-entities[aria-label^="Entities to ${name.toLowerCase()}"]`);
    await expect(entities).toContainText('Edge of Revolve 1', { timeout: 10000 });
    const picked = JSON.parse(await dialog().locator('[aria-label="Picked edges"]').inputValue())[0];
    assert.ok(Math.abs(picked.midpointMillimeters?.[2] - 10) < 1e-5, 'Initial shoulder: ' + JSON.stringify(picked));
    await dialog().locator(`[aria-label="${field}"]`).fill('0.5');
    const sizeHandle = page.getByRole('button', { name: name === 'Fillet' ? 'Fillet radius' : 'Chamfer size', exact: true });
    await sizeHandle.focus();
    await expect(sizeHandle).toBeEnabled({ timeout: 45000 }); await sizeHandle.press('ArrowUp');
    await expect(dialog().locator(`[aria-label="${field}"]`)).toHaveValue('1.5');
    await accept();
    await expect.poll(async () => (await stored(file.id)).features.at(-1).type, { timeout: 30000 }).toBe(name.toLowerCase());
    // Editing must hit the earlier native shoulder, with the same edge/face rule.
    await row(new RegExp('^' + name)).dblclick();
    await entities.getByRole('button', { name: /Remove/ }).first().click();
    await pick(); await expect(entities).toContainText('Edge of Revolve 1');
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
    await page.screenshot({ path: join(evidence, `${name.toLowerCase()}-shoulder-edit.png`) });
    await accept();
    const saved = await stored(file.id); const edge = saved.features.at(-1).edges[0];
    await writeFile(join(evidence, `${name.toLowerCase()}-shoulder.part.json`), JSON.stringify(saved));
    assert.equal(edge.kind, 'curved-edge'); assert.ok(Math.abs(edge.midpointMillimeters[2] - 10) < 1e-5, JSON.stringify(edge));
    results.push(`${name}: native stepped shoulder picked, previewed, applied, reselected while editing and saved`);
  }
  }
  await verifyExtrudeDirection({ page, expect, dialog, row, point, open, stored, accept, base, sketch, evidence, results });
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'feature-controls.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'feature-controls-failure.png') });
  await writeFile(join(evidence, 'feature-controls-failure.txt'), `${error.stack}\n${await dialog().allTextContents()}`);
  throw error;
} finally { await browser.close(); }
