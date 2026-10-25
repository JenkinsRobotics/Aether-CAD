/** Real source picker and Files drag, against an isolated authenticated Studio. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), steps = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => { if (response.status() >= 400 && response.url().includes('/api/')) await appendFile(join(evidence, 'http-errors.jsonl'), JSON.stringify({ url: response.url(), status: response.status(), body: await response.text() }) + '\n'); });
const button = name => page.getByRole('button', { name, exact: true });
const panel = page.getByRole('region', { name: 'Files navigation', exact: true });
const api = (action, data) => page.evaluate(async ({ action, data }) => {
 const response = await fetch('/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
 const result = await response.json(); if (!response.ok) throw Error(action + ': ' + JSON.stringify(result)); return result;
}, { action, data });
const step = async (name, run) => { console.log('Begin ' + name); await appendFile(join(evidence, 'progress.log'), 'Begin ' + name + '\n'); await run(); steps.push(name); await page.screenshot({ path: join(evidence, steps.length + '-' + name + '.png') }); console.log('Passed ' + name); };
const dialog = () => page.getByRole('dialog', { name: 'Insert parts', exact: true });
let source, design, partId, assemblyId;
const graph = async () => {
 const saved = await api('library/read', { app: 'cad', id: design });
 return JSON.parse(execFileSync('python3', ['-c', 'import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(z.read("state/graph.json").decode())'], { input: Buffer.from(saved.data_base64, 'base64'), encoding: 'utf8' }));
};
const count = async n => expect.poll(async () => (await graph()).instances.length, { timeout: 90000 }).toBe(n);
const openInsert = async () => { await page.locator('.cad-parts-panel').getByRole('button', { name: 'Insert Part', exact: true }).click(); await expect(dialog()).toBeVisible(); };
try {
 await page.goto(origin + '/cad/'); await page.locator('input[name="username"]').fill('editor'); await page.locator('input[name="password"]').fill('account-test-password-2026'); await button('Sign in').click(); await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 }); await page.waitForLoadState('networkidle');
 const document = { format: 'aether-part', formatVersion: 22, documentId: randomUUID(), name: 'Bracket', units: 'millimeter', features: [
  { id: 'profile', name: 'Rectangle', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: { type: 'polygon', pointsMillimeters: [[-20,-10],[20,-10],[20,10],[-20,10]] } },
  { id: 'extrude', name: 'Extrude', type: 'extrude', profileFeatureId: 'profile', suppressed: false, operation: 'new', distanceMillimeters: 12 },
 ] };
 source = await api('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Source bracket.acpart', data_base64: Buffer.from(JSON.stringify(document)).toString('base64') });
 await page.goto(`${origin}/cad/index.html?document=${source.id}`); await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 }); await button('Files').click();
 await panel.getByRole('button', { name: 'Design actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Create Hybrid design from this Part…', exact: true }).click();
 await page.getByRole('dialog').getByRole('textbox').fill('Insertion fixture'); await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 }); await expect(panel).toContainText('Main Assembly');
 design = new URL(page.url()).searchParams.get('document'); const projected = await api('library/project_read', { app: 'cad', id: design }); partId = projected.project.parts[0].id; assemblyId = projected.project.assemblies[0].id;
 // Keep an unrelated empty Part in the container: it must not poison the solve.
 await panel.getByRole('button', { name: 'Create in this design', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Create Part Studio…', exact: true }).click();
 await page.getByRole('dialog').getByRole('textbox').fill('Unfinished');
 await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 }); await expect(panel).toContainText('Unfinished');
 await page.goto(`${origin}/cad/index.html?document=${design}&assembly=${assemblyId}`); await expect(page.locator('.cad-parts-panel')).toBeVisible({ timeout: 90000 });
 if (!await panel.isVisible()) await button('Files').click();
 await step('insert-existing-hybrid-part', async () => {
  await openInsert(); await expect(dialog().getByRole('button', { name: /Unfinished/ })).toBeDisabled();
  await dialog().getByRole('button', { name: 'Bracket Part Studio', exact: true }).click(); await page.locator('#assembly-position-x').fill('35');
  await dialog().getByRole('checkbox', { name: 'Ground component', exact: true }).check(); await dialog().getByRole('button', { name: 'Insert Part', exact: true }).click();
  await expect(dialog()).toHaveCount(0, { timeout: 90000 }); await count(1);
  const value = await graph(); assert.equal(value.part_definitions.length, 2); assert.equal(value.instances[0].definition_id, partId); assert.equal(value.instances[0].rest_transform.position_m[0], .035); assert.equal(value.instances[0].grounded, true);
  await expect(page.locator('.cad-parts-panel')).toContainText('Bracket:1');
 });
 await step('drag-from-files-and-undo-redo', async () => {
  const row = panel.locator(`[data-document-tab-id="${partId}"]`);
  await row.dragTo(page.locator('#viewport'), { targetPosition: { x: 650, y: 450 } }); await count(2);
  let value = await graph(); assert.equal(value.part_definitions.length, 2); assert.equal(value.instances[1].definition_id, partId);
  await page.keyboard.press('ControlOrMeta+z'); await count(1); await page.keyboard.press('ControlOrMeta+Shift+z'); await count(2);
 });
 await step('copy-from-other-design-and-save-reopen', async () => {
  await openInsert(); await dialog().getByRole('tab', { name: 'Other designs', exact: true }).click();
  await dialog().getByRole('button', { name: /Source bracket.acpart/ }).click(); await dialog().getByRole('button', { name: 'Bracket Part Studio', exact: true }).click();
  await page.locator('#assembly-position-y').fill('40'); await dialog().getByRole('button', { name: 'Insert Part', exact: true }).click(); await expect(dialog()).toHaveCount(0, { timeout: 90000 }); await count(3);
  const value = await graph(); assert.equal(value.part_definitions.length, 3); assert.notEqual(value.instances[2].definition_id, partId); assert.equal(value.instances[2].rest_transform.position_m[1], .04);
  const copy = value.part_definitions.find(part => part.id === value.instances[2].definition_id); assert.equal(copy.feature_document.features.length, 2);
  assert.equal((await api('library/read', { app: 'cad', id: source.id })).revision, source.revision);
  await page.reload(); await expect(page.locator('.cad-parts-panel')).toContainText('Bracket:3', { timeout: 90000 }); await count(3);
 });
 await step('insert-part-from-saved-hybrid', async () => {
  await openInsert(); await dialog().getByRole('tab', { name: 'Other designs', exact: true }).click();
  await dialog().getByRole('button', { name: /Insertion fixture.acad/ }).click();
  await expect(dialog().getByRole('button', { name: /Main Assembly/ })).toBeDisabled();
  await dialog().getByRole('button', { name: 'Bracket Part Studio', exact: true }).first().click();
  await page.locator('#assembly-position-z').fill('25'); await dialog().getByRole('button', { name: 'Insert Part', exact: true }).click(); await expect(dialog()).toHaveCount(0, { timeout: 90000 }); await count(4);
  const value = await graph(); assert.equal(value.part_definitions.length, 4); assert.equal(value.instances[3].rest_transform.position_m[2], .025);
 });
 await step('standard-library-and-compact-picker', async () => {
  await page.setViewportSize({ width: 1024, height: 768 }); await openInsert();
  assert.equal(await dialog().evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.screenshot({ path: join(evidence, 'compact-picker.png') });
  await dialog().getByRole('tab', { name: 'Standard parts', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('ISO');
  await page.keyboard.press('Escape'); await count(4);
 });
 await step('compact-circle-and-rectangle-tools', async () => {
  await page.goto(`${origin}/cad/index.html?document=${source.id}`);
  await page.getByRole('treeitem', { name: /^Rectangle/ }).first().waitFor({ timeout: 90000 });
  await page.getByRole('treeitem', { name: /^Rectangle/ }).first().dblclick();
  await expect(page.locator('.cad-sketch-window')).toBeVisible();
  const choose = async (name, id) => {
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.aui-command-palette input').fill(name);
    await page.locator(`[role="option"][id$="-${id}"]`).click();
  };
  for (const [name, id] of [['Circle', 'sketch-circle'], ['Rectangle', 'sketch-rectangle']]) {
    await choose(name, id);
    const popup = page.locator('.cad-sketch-tool-window'); await expect(popup).toBeVisible();
    await expect(popup.locator('.aui-float-panel-title')).toHaveText(name);
    await expect(page.locator('.cad-sketch-window')).not.toBeVisible();
    const x = await popup.getByLabel('X (mm)', { exact: true }).boundingBox();
    const y = await popup.getByLabel('Y (mm)', { exact: true }).boundingBox();
    assert.ok(Math.abs(x.y - y.y) < 2, 'XY controls share one row');
    const bounds = await popup.boundingBox(); assert.ok(bounds.width <= 310 && bounds.height < 360, JSON.stringify(bounds));
    await expect(popup.getByRole('button', { name: 'New contour', exact: true })).not.toBeVisible();
    await expect(popup.getByRole('combobox', { name: 'Sketch editor', exact: true })).toHaveCount(0);
    assert.equal(await popup.locator('details').evaluate(element => element.open), false);
    assert.equal(await popup.evaluate(element => element.scrollWidth > element.clientWidth), false);
    await page.screenshot({ path: join(evidence, `compact-${name.toLowerCase()}.png`) });
    for (const [px, py] of [[70, 0], [80, 10]]) {
      await popup.getByLabel('X (mm)', { exact: true }).fill(String(px)); await popup.getByLabel('Y (mm)', { exact: true }).fill(String(py));
      await popup.getByRole('button', { name: 'Place point', exact: true }).click();
    }
  }
  await page.locator('.cad-sketch-tool-window').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.cad-sketch-window')).toBeVisible();
  await page.locator('.cad-sketch-window [data-feature-action="discard"]').click();
  await expect(page.locator('.cad-sketch-window')).toHaveCount(0);
  assert.equal((await api('library/read', { app: 'cad', id: source.id })).revision, source.revision);
 });
 assert.deepEqual(errors, []); await writeFile(join(evidence, 'result.json'), JSON.stringify({ steps, errors, design, source: source.id }, null, 2)); console.log('Assembly insertion passed: ' + steps.length + ' real browser workflows');
} catch (error) { await page.screenshot({ path: join(evidence, 'failure.png') }); await writeFile(join(evidence, 'failure.json'), JSON.stringify({ error: String(error), errors, steps, url: page.url() }, null, 2)); throw error; }
finally { await browser.close(); }
