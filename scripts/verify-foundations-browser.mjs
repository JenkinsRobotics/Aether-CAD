/** Shared dependency graph and published agent contracts on a disposable host. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectLiveAgent } from './browser/live-agent.mjs';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';

const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ??
  fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN;
const evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], steps = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const request = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text());
  return response.json();
}, { action, data });
const step = async (name, action) => {
  console.log('Begin ' + name); await action(); steps.push(name);
  await page.screenshot({ path: join(evidence, name + '.png') }); console.log('Passed ' + name);
};
let agent, file;
const read = async () => tabDocumentOf((await request('library/read', { app: 'cad', id: file.id })).data_base64);
const parts = () => page.locator('.cad-parts-list').getByRole('treeitem');
const row = name => page.getByRole('treeitem', { name: new RegExp('^' + name) }).first();
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const document = { format: 'aether-part', formatVersion: 22, documentId: randomUUID(), name: 'Foundation fixture', units: 'millimeter', features: [
    { id: 'profile', name: 'Rectangle', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: { type: 'polygon', pointsMillimeters: [[10, 0], [20, 0], [20, 10], [10, 10]] } },
    { id: 'pad', name: 'Extrude', type: 'extrude', profileFeatureId: 'profile', suppressed: false, operation: 'new', bodyId: 'base', distanceMillimeters: 5 },
    { id: 'plane', name: 'Datum', type: 'plane', plane: 'YZ', offsetMillimeters: 0, suppressed: false },
    { id: 'axis', name: 'Polar axis', type: 'axis', suppressed: false, definition: { method: 'two-planes', references: [{ kind: 'feature', featureId: 'plane' }, { kind: 'principal', plane: 'XZ' }] } },
    { id: 'pattern', name: 'Body pattern', type: 'pattern', suppressed: false, sourceFeatureId: 'pad', patternType: 'polar', axis: 'Z', axisReference: { kind: 'feature', featureId: 'axis' }, count: 3, angleDegrees: 360, reversed: false, bodyIds: ['base'], copyBodyIds: { base: 'copy' } },
  ] };
  file = await request('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Foundations.aethercad', data_base64: partDocumentBase64(document) });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await row('Body pattern').waitFor({ timeout: 90000 });
  await expect(parts()).toHaveCount(3, { timeout: 90000 });

  await step('shared-ui-suppression-and-history', async () => {
    await row('Datum').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Suppress', exact: true }).click();
    await expect(parts()).toHaveCount(1, { timeout: 30000 });
    await expect.poll(async () => (await read()).features.filter(f => f.suppressed).map(f => f.id)).toEqual(['plane', 'axis', 'pattern']);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(parts()).toHaveCount(3, { timeout: 30000 });
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(parts()).toHaveCount(1, { timeout: 30000 });
    await row('Body pattern').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unsuppress', exact: true }).click();
    await expect(parts()).toHaveCount(3, { timeout: 30000 });
  });

  await step('mcp-dependencies-and-atomic-refusal', async () => {
    agent = await connectLiveAgent(page, origin, file.id, 'Foundations acceptance');
    const refs = await agent.invoke('aether_cad_feature_references', { feature_id: 'pattern' });
    assert.ok(refs.references.some(ref => ref.id === 'axis'));
    assert.ok(!refs.references.some(ref => ref.id === 'pattern'));
    const before = await agent.invoke('aether_cad_inspect');
    await agent.invoke('aether_cad_feature_delete', { feature_id: 'axis' }, false);
    await agent.invoke('aether_cad_sketch_circle', { frame: { origin_mm: [0, 0], x_direction: [1, 0, 0], y_direction: [0, 1, 0] }, center_x_mm: 0, center_y_mm: 0, radius_mm: 5 }, false);
    assert.deepEqual(await agent.invoke('aether_cad_inspect'), before);
    await agent.invoke('aether_cad_suppress', { feature_id: 'plane', suppressed: true });
    await expect(parts()).toHaveCount(1, { timeout: 30000 });
    await agent.invoke('aether_cad_suppress', { feature_id: 'pattern', suppressed: false });
    await expect(parts()).toHaveCount(3, { timeout: 30000 });
    await agent.dispose(); agent = undefined;
  });

  await step('saved-reopen-retains-identities', async () => {
    await expect.poll(async () => (await read()).features.filter(f => f.suppressed).length).toBe(0);
    const saved = await read();
    assert.deepEqual(saved.features.map(f => f.id), document.features.map(f => f.id));
    assert.deepEqual(saved.features.at(-1).copyBodyIds, { base: 'copy' });
    await writeFile(join(evidence, 'foundations.part.json'), JSON.stringify(saved));
    await page.reload();
    await expect(parts()).toHaveCount(3, { timeout: 90000 });
  });
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ steps, errors, file: file.id }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') });
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ error: String(error), steps, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
