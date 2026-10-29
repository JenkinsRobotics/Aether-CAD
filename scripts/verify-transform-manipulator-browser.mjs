/** Part definition versus Assembly placement on a disposable authenticated host. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectLiveAgent } from './browser/live-agent.mjs';
const { chromium, webkit, expect } = createRequire(fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await (process.env.AETHER_MOVE_BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(20000);
const errors = [], steps = [], legacyRPC = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (new URL(r.url()).pathname === '/cad/rpc') legacyRPC.push(r.url()); });
const request = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text()); return response.json();
}, { action, data });
const read = async id => Buffer.from((await request('library/read', { app: 'cad', id })).data_base64, 'base64');
const graph = async id => JSON.parse(execFileSync('python3', ['-c', 'import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(z.read("state/graph.json").decode())'], { input: await read(id), encoding: 'utf8' }));
const handle = id => page.locator(`.cad-selection-manipulator [data-transform-handle="${id}"]`);
const center = async id => { const b = await handle(id).boundingBox(); assert.ok(b); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const project = points => page.evaluate(points => { let result; window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points, respond: value => result = value } })); return result; }, points);
const pixel = async point => {
  const [at] = await project([point]);
  const bytes = await page.screenshot({ style: '.cad-selection-manipulator { visibility:hidden !important; }' });
  return page.evaluate(async ({ encoded, at }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data];
  }, { encoded: bytes.toString('base64'), at });
};
const isSolid = p => Math.max(...p.slice(0, 3)) > 90;
const button = name => page.getByRole('button', { name, exact: true });
const fit = async () => { await page.locator('.cad-studio-view-tools').getByRole('button', { name: 'Fit view', exact: true }).click(); await button('Top view').press('Enter'); await page.waitForTimeout(450); };
const step = async (name, run) => { console.log('Begin ' + name); await run(); steps.push(name); await page.screenshot({ path: join(evidence, name + '.png') }); console.log('Passed ' + name); };
let agent;
try {
  await page.goto(origin + '/cad/'); await page.locator('input[name="username"]').fill('editor'); await page.locator('input[name="password"]').fill('account-test-password-2026'); await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 }); await page.waitForLoadState('networkidle');
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.acpart', import.meta.url), 'utf8'));
  data.formatVersion = 22; data.documentId = randomUUID(); data.name = 'Origin-constrained block';
  const contour = { type: 'path', start: [0, 0], segments: [ { type: 'line', end: [20, 0] }, { type: 'line', end: [20, 20] }, { type: 'line', end: [0, 20] }, { type: 'line', end: [0, 0] } ] };
  data.features[0].profile = { type: 'drawing', contours: [contour], constraints: [{ id: 'fixed-outline', kind: 'fix', a: { contour: 0, kind: 'contour' }, fixedGeometry: structuredClone(contour) }] };
  const file = await request('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Fixed part.acpart', data_base64: Buffer.from(JSON.stringify(data)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`); await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
  await step('part-stays-at-modeled-coordinates', async () => {
    await fit(); await page.locator('.cad-parts-list').getByRole('treeitem').first().click();
    await expect(handle('pivot')).toBeHidden();
    const [at] = await project([[10, 10, 5]]);
    await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 65, at.y + 20, { steps: 8 }); await page.mouse.up();
    await expect(handle('pivot')).toBeHidden();
    assert.deepEqual(JSON.parse((await read(file.id)).toString()).features, data.features);
    assert.equal(isSolid(await pixel([10, 10, 5])), true);
    await page.reload(); await page.getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
    assert.deepEqual(JSON.parse((await read(file.id)).toString()).features, data.features);
  });
  const assembly = await request('library/project_create', { app: 'cad', name: 'Placement qualification', operation_id: randomUUID(), packaging: 'assembly', scope: 'personal' });
  const url = `${origin}/cad/index.html?document=${assembly.id}&assembly=${assembly.project.assemblies[0].id}`;
  await page.goto(url); await page.locator('.aui-studio-document-title').filter({ hasText: 'Placement qualification' }).waitFor({ timeout: 90000 });
  agent = await connectLiveAgent(page, origin, assembly.id, 'Placement fixture');
  const inspect = section => agent.invoke('aether_cad_assembly_inspect', { section: section ?? 'summary' });
  const initial = await inspect(), recipe = initial.example;
  delete recipe.patterns;
  recipe.parts = [{ key: 'block', name: 'Constrained block', document: data }];
  recipe.instances = [{ key: 'Fixed block', part: 'block', grounded: true }, { key: 'Moving block', part: 'block', position_mm: [80, 0, 0] }];
  recipe.mates = [];
  await agent.invoke('aether_cad_assembly_compose', { expected_revision: initial.revision, recipe_json: JSON.stringify(recipe) });
  if (await page.getByRole('textbox', { name: /^Ask / }).isVisible()) await button('AI advisor').click();
  const instances = async () => (await inspect('instances')).items;
  const moving = async () => (await instances()).find(i => i.name === 'Moving block');
  const select = name => page.getByRole('treeitem').filter({ hasText: name }).last().click();
  await fit();
  await expect.poll(async () => (await graph(assembly.id)).part_definitions.length, { timeout: 30000 }).toBe(1);
  const before = await graph(assembly.id), beforePose = (await moving()).rest_transform;
  await step('fixed-instance-has-no-free-move', async () => {
    await select('Fixed block'); await expect(handle('pivot')).toBeHidden();
    await select('Moving block'); await expect(handle('pivot')).toBeVisible();
  });
  let movedPose;
  await step('live-body-and-handle-follow-together', async () => {
    assert.equal(isSolid(await pixel([90, 10, 5])), true);
    assert.equal(isSolid(await pixel([120, 10, 5])), false);
    const [a, b] = await project([[90, 10, 2.5], [120, 10, 2.5]]), from = await center('moveX');
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + b.x - a.x, from.y + b.y - a.y, { steps: 12 });
    // Inspect actual rendered pixels while the pointer is STILL down.
    await expect.poll(async () => isSolid(await pixel([90, 10, 5]))).toBe(false);
    await expect.poll(async () => isSolid(await pixel([120, 10, 5]))).toBe(true);
    const pivot = await center('pivot'); assert.ok(Math.hypot(pivot.x - b.x, pivot.y - b.y) < 2, 'Handle attached to previewed body');
    assert.deepEqual((await moving()).rest_transform, beforePose, 'Preview has no canonical edit before release');
    await page.screenshot({ path: join(evidence, 'pointer-down-live.png') });
    await page.mouse.up();
    await expect.poll(async () => (await moving()).rest_transform.position_m[0], { timeout: 60000 }).toBeCloseTo(.11, 3);
    await expect(handle('moveX')).toBeEnabled({ timeout: 60000 });
    movedPose = (await moving()).rest_transform;
    const after = await graph(assembly.id); assert.deepEqual(after.part_definitions, before.part_definitions);
    assert.equal(isSolid(await pixel([120, 10, 5])), true);
    const final = await center('pivot'); assert.ok(Math.hypot(final.x - b.x, final.y - b.y) < 2, 'No handle jump after commit');
  });
  await step('cancel-history-and-saved-reopen', async () => {
    const at = await center('moveX'); await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 50, at.y, { steps: 8 }); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual((await moving()).rest_transform, movedPose);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await moving()).rest_transform.position_m[0], { timeout: 60000 }).toBeCloseTo(.08, 6);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(async () => (await moving()).rest_transform.position_m[0], { timeout: 60000 }).toBeCloseTo(.11, 3);
    await expect.poll(async () => (await graph(assembly.id)).instances.find(i => i.name === 'Moving block').rest_transform.position_m[0], { timeout: 60000 }).toBeCloseTo(.11, 3);
    if (!await page.getByRole('textbox', { name: /^Ask / }).isVisible()) await button('AI advisor').click();
    await agent.dispose(); agent = null;
    await page.reload(); await page.getByRole('treeitem').filter({ hasText: 'Moving block' }).last().waitFor({ timeout: 90000 });
    await select('Moving block'); await expect(handle('pivot')).toBeVisible();
    const saved = await graph(assembly.id); assert.deepEqual(saved.part_definitions, before.part_definitions);
    assert.deepEqual(saved.instances.find(i => i.name === 'Moving block').rest_transform, movedPose);
    await writeFile(join(evidence, 'assembly-graph.json'), JSON.stringify(saved, null, 2));
  });
  assert.deepEqual(errors, []); assert.deepEqual(legacyRPC, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ steps, errors, legacyRPC }, null, 2));
} catch (e) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), String(e.stack) + '\n' + JSON.stringify({ steps, errors })); throw e;
} finally { await browser.close(); }
