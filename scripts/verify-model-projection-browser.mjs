/** Real UI Include Geometry, live MCP, exact extrusion and saved reopen. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
const palette = async id => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('listbox', { name: 'Commands' }).locator('..').getByRole('combobox').or(page.locator('.aui-command-palette input')).first().fill('Include 3D edges');
  await page.locator(`[role="option"][id$="-${id}"]`).click();
};
let file, agent;
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  const profile = (id, z, geometry) => ({ id, name: id, type: 'profile', plane: 'XY', offsetMillimeters: z, suppressed: false, profile: geometry });
  const document = { format: 'aether-part', formatVersion: 21, documentId: randomUUID(), name: 'Model projection', units: 'millimeter', features: [
    profile('Source circle', 0, { type: 'circle', centerMillimeters: [3, 4], radiusMillimeters: 5 }),
    { id: 'extrude', name: 'Source extrusion', type: 'extrude', profileFeatureId: 'Source circle', distanceMillimeters: 10, operation: 'new', suppressed: false },
    profile('Offset sketch', 25, { type: 'drawing', contours: [] }),
  ] };
  file = await request('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Model projection.acpart', data_base64: Buffer.from(JSON.stringify(document)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await row(/^Offset sketch/).waitFor({ timeout: 90000 });
  await step('ui-project-displaced-model', async () => {
    await row(/^Offset sketch/).dblclick();
    await expect(page.locator('.cad-sketch-window')).toBeVisible();
    await palette('sketch-include-edges');
    await expect(page.locator('.cad-sketch-workspace')).toContainText('editable copies', { timeout: 30000 });
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.locator('.cad-sketch-window [data-feature-action="accept"]').click();
    await expect(page.locator('.cad-sketch-window')).toHaveCount(0, { timeout: 30000 });
    await expect.poll(async () => (await read(file.id)).features.at(-1).profile.contours.filter(c => c.type === 'circle').length, { timeout: 30000 }).toBe(1);
    const ring = (await read(file.id)).features.at(-1).profile.contours.find(c => c.type === 'circle');
    assert.equal(ring.radius, 5); assert.deepEqual(ring.center, [3, 4]); assert.ok(ring.id);
  });
  await step('live-agent-projection-and-undo', async () => {
    agent = await connectLiveAgent(page, origin, file.id, 'Model projection fixture');
    assert.ok(agent.catalog.some(tool => tool.name === 'aether_cad_sketch_include_model'));
    const before = await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'Offset sketch' });
    await agent.invoke('aether_cad_sketch_include_model', { feature_id: 'Offset sketch', entities_json: '[{"body_id":"missing"}]' }, false);
    assert.deepEqual(await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'Offset sketch' }), before);
    const included = await agent.invoke('aether_cad_sketch_include_model', { feature_id: 'Offset sketch', construction: true });
    assert.equal(included.projection.associative, false); assert.deepEqual(included.projection.approximated_edges, []);
    assert.ok((await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'Offset sketch' })).profile.contours.some(c => c.construction));
    await agent.invoke('aether_cad_undo');
    assert.deepEqual(await agent.invoke('aether_cad_sketch_inspect', { feature_id: 'Offset sketch' }), before);
    await agent.invoke('aether_cad_redo'); await agent.invoke('aether_cad_undo');
  });
  await step('extrude-projection-and-reopen', async () => {
    const result = await agent.invoke('aether_cad_extrude', { profile_id: 'Offset sketch', profile_point_mm: [3, 4], depth_mm: 5, operation: 'new' });
    assert.equal(result.body_count, 2);
    await expect.poll(async () => (await read(file.id)).features.length, { timeout: 30000 }).toBe(4);
    const saved = await read(file.id); await writeFile(join(evidence, 'projected.acpart'), JSON.stringify(saved));
    await agent.dispose(); agent = undefined;
    await page.reload(); await expect(row(/^Offset sketch/)).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.cad-parts-list').getByRole('treeitem')).toHaveCount(2, { timeout: 30000 });
    assert.deepEqual(await read(file.id), saved);
  });
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ steps, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), `${error.stack}\n${JSON.stringify({ steps, errors })}`);
  throw error;
} finally { await browser.close(); }
