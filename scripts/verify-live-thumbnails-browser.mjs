/** Real saved Hybrid: Part images, whole Assembly, live edits, undo and reopen. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectLiveAgent } from './browser/live-agent.mjs';
import { readAetherCAD } from '../src/document/aethercad-archive.ts';
const { chromium, webkit, expect } = createRequire(new URL('../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const name = process.env.AETHER_THUMBNAIL_BROWSER ?? 'chromium';
const browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true, ...(name === 'webkit' ? {} : { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(30000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const panel = page.getByRole('region', { name: 'Files navigation', exact: true });
const images = () => panel.locator('.aui-tab-browser-thumb img');
const sources = () => images().evaluateAll(images => images.map(image => image.src));
const api = (action, data) => page.evaluate(async ({ action, data }) => { const r = await fetch('/api/library/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', ...data }) }); if (!r.ok) throw Error(await r.text()); return r.json(); }, { action, data });
let agent;
try {
  await page.goto(origin + '/cad/'); await page.locator('input[name="username"]').fill('editor'); await page.locator('input[name="password"]').fill('account-test-password-2026'); await button('Sign in').click(); await expect(page.locator('input[name="password"]')).toHaveCount(0); await page.waitForLoadState('networkidle');
  const bytes = await readFile(new URL('../public/examples/reference-enclosure.aethercad.bin', import.meta.url));
  const graph = readAetherCAD(bytes).graph, part = graph.part_definitions[0], extrude = part.feature_document.features.find(f => f.type === 'extrude');
  const file = await api('create', { name: 'Live thumbnail design.aethercad', scope: 'personal', operation_id: randomUUID(), data_base64: bytes.toString('base64') });
  const url = `${origin}/cad/index.html?document=${file.id}&part=${part.id}`;
  await page.goto(url); await page.getByRole('tree', { name: 'CAD features' }).waitFor({ timeout: 90000 }); await button('Files').click();
  await expect(images()).toHaveCount(3, { timeout: 90000 }); const before = await sources(); assert.equal(new Set(before).size, 3);
  await page.screenshot({ path: join(evidence, 'original.png') });
  agent = await connectLiveAgent(page, origin, file.id, 'Live thumbnail qualification'); await button('Files').click();
  await agent.invoke('aether_cad_feature_update', { feature_id: extrude.id, changes_json: JSON.stringify({ distanceMillimeters: 36 }) });
  await expect.poll(async () => { const now = await sources(); return now.length === 3 && now[0] !== before[0] && now[1] === before[1] && now[2] !== before[2]; }, { timeout: 90000, message: 'Only changed Part and containing Assembly refresh' }).toBe(true);
  const edited = await sources(); await page.screenshot({ path: join(evidence, 'edited.png') });
  await page.keyboard.press('Meta+z'); await expect.poll(sources, { timeout: 90000 }).toEqual(before);
  await page.keyboard.press('Meta+Shift+z'); await expect.poll(sources, { timeout: 90000 }).toEqual(edited);
  await expect.poll(async () => { const saved = await api('read', { id: file.id }); return readAetherCAD(Buffer.from(saved.data_base64, 'base64')).graph.part_definitions[0].feature_document.features.find(f => f.id === extrude.id).distanceMillimeters; }).toBe(36);
  await button('AI advisor').click(); await agent.dispose(); agent = null; await button('Files').click(); await page.reload();
  await expect(images()).toHaveCount(3, { timeout: 90000 }); await expect.poll(sources).toEqual(edited);
  await page.goto(origin + '/cad/');
  await page.getByRole('heading', { name: 'Get started', exact: true }).waitFor();
  await page.getByRole('button', { name: /My files/, exact: false }).first().click();
  const filePreview = page.getByRole('img', { name: 'Preview of Live thumbnail design.aethercad', exact: true });
  await expect(filePreview.first()).toBeVisible({ timeout: 90000 });
  assert.equal(await filePreview.first().getAttribute('src'), edited[2], 'Top-level file depicts the complete assembly');
  await page.screenshot({ path: join(evidence, 'file-assembly-preview.png') });
  if (process.env.AETHER_CHECK_CONFIGURATIONS === '1') {
    await page.goto(origin + '/cad/?example=artemis-sls');
    await page.getByRole('tree', { name: 'CAD assembly components' }).waitFor({ timeout: 90000 });
    if (!await panel.isVisible()) await button('Files').click();
    const assemblies = panel.locator('[data-document-tab-id]').filter({ hasText: 'Assembly ·' });
    const count = await assemblies.count(); assert.ok(count > 1);
    await expect(assemblies.locator('.aui-tab-browser-thumb img')).toHaveCount(count, { timeout: 180000 });
    const images = await assemblies.locator('.aui-tab-browser-thumb img').evaluateAll(images => images.map(image => image.src));
    assert.equal(new Set(images).size, count, 'Each assembly configuration has its own picture');
    await page.screenshot({ path: join(evidence, 'assembly-configurations.png') });
  }
  assert.deepEqual(errors, []); await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, browser: name, distinctPartAndAssemblyImages: true, liveEdit: true, unchangedPartRetained: true, undoRedo: true, savedReopen: true, topLevelAssembly: true, configurations: process.env.AETHER_CHECK_CONFIGURATIONS === '1', errors }, null, 2));
} catch (error) { await page.screenshot({ path: join(evidence, 'failure.png') }); await writeFile(join(evidence, 'failure-dom.txt'), await page.locator('body').innerText()); throw error; }
finally { await browser.close(); }
