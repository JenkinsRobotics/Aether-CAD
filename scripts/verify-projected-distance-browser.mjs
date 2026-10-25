/** Projected distance editing, source crossing, UI history and live/saved parity. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectLiveAgent } from './browser/live-agent.mjs';
const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], steps = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname === '/api/cad/geometry') errors.push('Server geometry request'); });
const button = name => page.getByRole('button', { name, exact: true });
const step = async (name, action) => { console.log('Begin ' + name); await action(); steps.push(name); await page.screenshot({ path: join(evidence, `${steps.length}-${name}.png`) }); console.log('Passed ' + name); };
const row = name => page.getByRole('treeitem', { name }).first();
const request = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text()); return response.json();
}, { action, data });
const read = async id => JSON.parse(Buffer.from((await request('library/read', { app: 'cad', id })).data_base64, 'base64'));
let file, agent, geometryVisits = 0;
const openGeometry = async () => {
  await row(/^Clearance/).dblclick();
  await expect(page.locator(".cad-projection-window")).toBeVisible();
  const preview = page.locator('.cad-projection-preview');
  assert.equal(Math.round((await preview.boundingBox()).height), 140);
  assert.notEqual(await preview.locator('.sketch-entity-edge').first().evaluate(el => getComputedStyle(el).stroke), 'none');
  assert.ok(Number(await preview.locator('.sketch-plane-face').evaluate(el => getComputedStyle(el).fillOpacity)) < 0.5);
  const bodyBounds = await page.locator('.cad-projection-window .aui-float-panel-body').boundingBox();
  const actionBounds = await button('Save and edit geometry').boundingBox();
  assert.ok(actionBounds.y >= bodyBounds.y && actionBounds.y + actionBounds.height <= bodyBounds.y + bodyBounds.height, 'Edit geometry must be visible without scrolling');
  await page.screenshot({ path: join(evidence, `projection-settings-${++geometryVisits}.png`) });
  await button('Save and edit geometry').click();
  await expect(page.locator('.cad-sketch-window')).toBeVisible();
};
const closeGeometry = async () => {
  await page.locator('.cad-sketch-window [data-feature-action="accept"]').click();
  await expect(page.locator('.cad-sketch-window')).toHaveCount(0, { timeout: 30000 });
};
const circleY = async () => -Number(await page.locator('circle.sketch-contour').first().getAttribute('cy'));
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  const document = JSON.parse(await readFile(new URL('../service/tests/fixtures/projected-distance.json', import.meta.url), 'utf8'));
  document.documentId = randomUUID();
  file = await request('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Distance intent.acpart', data_base64: Buffer.from(JSON.stringify(document)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await row(/^Clearance/).waitFor({ timeout: 90000 });
  await step('ui-dimension-edit-undo-redo', async () => {
    await openGeometry();
    await page.locator('.sketch-dimension[data-constraint-id="gap"] text').first().dblclick();
    await page.getByRole('textbox', { name: 'Dimension value', exact: true }).fill('6');
    await button('Confirm dimension').click();
    await expect.poll(circleY).toBeCloseTo(44, 5);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(circleY).toBeCloseTo(45, 5);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(circleY).toBeCloseTo(44, 5);
    await page.screenshot({ path: join(evidence, "dimension-after-redo.png") });
    await closeGeometry();
    await expect.poll(async () => (await read(file.id)).features[1].profile.authored.constraints[0].value).toBe(6);
    assert.equal((await read(file.id)).features[1].profile.authored.constraints[0].distanceSide, 1);
  });
  await step('live-source-crossing-and-projected-dimension', async () => {
    agent = await connectLiveAgent(page, origin, file.id, 'Distance intent fixture');
    const before = await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'target' });
    await agent.invoke('aether_cad_sketch_dimension', { feature_id: 'target', dimension_id: 'gap', value: -1 }, false);
    assert.deepEqual(await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'target' }), before);
    await agent.invoke('aether_cad_sketch_translate', { feature_id: 'source', dx_mm: 0, dy_mm: -30 });
    await agent.invoke('aether_cad_sketch_dimension', { feature_id: 'target', dimension_id: 'gap', value: 7 });
    const edited = await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'target' });
    assert.ok(Math.abs(edited.profile.contours[0].center[1] - 13) < 1e-5);
    assert.equal(edited.profile.constraints[0].distanceSide, 1);
    await agent.invoke('aether_cad_undo'); await agent.invoke('aether_cad_redo');
    assert.deepEqual(await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'target' }), edited);
    await agent.invoke('aether_cad_extrude', { profile_id: 'target', profile_point_mm: [50, 13], depth_mm: 10, operation: 'new' });
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
    await agent.dispose(); agent = undefined;
  });
  await step('saved-reopen-and-projected-geometry', async () => {
    await expect.poll(async () => (await read(file.id)).features.length).toBe(3);
    const saved = await read(file.id);
    assert.equal(saved.formatVersion, 22);
    assert.equal(saved.features[1].profile.authored.projectionContext, undefined);
    assert.equal(saved.features[1].profile.sourceFeatureId, 'source');
    await writeFile(join(evidence, 'distance-intent.acpart'), JSON.stringify(saved));
    await page.reload(); await row(/^Clearance/).waitFor({ timeout: 90000 });
    await openGeometry(); await expect.poll(circleY).toBeCloseTo(13, 5);
    await closeGeometry();
    assert.equal((await read(file.id)).features[1].profile.authored.constraints[0].distanceSide, 1);
  });
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ steps, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), `${error.stack}\n${JSON.stringify({ steps, errors })}`);
  throw error;
} finally { await browser.close(); }
