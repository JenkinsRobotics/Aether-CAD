// Real native documents and actual UI interaction on the disposable Studio host.
import assert from 'node:assert/strict';
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
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
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
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'feature-controls.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'feature-controls-failure.png') });
  await writeFile(join(evidence, 'feature-controls-failure.txt'), `${error.stack}\n${await dialog().allTextContents()}`);
  throw error;
} finally { await browser.close(); }
