/** History rollback changes the real model and stays synchronized with Features. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, webkit, expect } = createRequire(fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await (process.env.AETHER_HISTORY_BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(20000);
const errors = [], steps = [], legacyRPC = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname === '/cad/rpc') legacyRPC.push(request.url()); });
const request = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text()); return response.json();
}, { action, data });
const read = async id => JSON.parse(Buffer.from((await request('library/read', { app: 'cad', id })).data_base64, 'base64').toString());
const button = name => page.getByRole('button', { name, exact: true });
const features = () => page.locator('[aria-label="CAD features"]');
const history = () => page.locator('[aria-label="Editing history"]');
const menu = async (name, command) => {
  await button('Actions for ' + name).click();
  await page.getByRole('menuitem', { name: command, exact: true }).click();
};
const pixel = async point => {
  const [at] = await page.evaluate(point => { let result; window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points: [point], respond: value => result = value } })); return result; }, point);
  assert.ok(at.x > 600 && at.x < 1060 && at.y > 120 && at.y < 740, 'Pixel sample must be inside the unobscured viewport: ' + JSON.stringify(at));
  const bytes = await page.screenshot();
  return page.evaluate(async ({ encoded, at }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data];
  }, { encoded: bytes.toString('base64'), at });
};
const solidAt = async point => Math.max(...(await pixel(point)).slice(0, 3)) > 90;
const step = async (name, run) => { console.log('Begin ' + name); await run(); steps.push(name); await page.screenshot({ path: join(evidence, name + '.png') }); console.log('Passed ' + name); };
try {
  await page.goto(origin + '/cad/'); await page.locator('input[name="username"]').fill('editor'); await page.locator('input[name="password"]').fill('account-test-password-2026'); await button('Sign in').click();
  await page.waitForURL(url => url.pathname === '/cad/');
  const data = JSON.parse(await readFile(new URL('../service/tests/fixtures/automation-part.acpart', import.meta.url), 'utf8'));
  data.formatVersion = 22; data.documentId = randomUUID(); data.name = 'Legacy moved block';
  data.features.push(...[20, 10].map((distance, index) => ({ id: 'move-' + index, name: 'Move parts ' + (index + 1), type: 'transform', suppressed: false, bodyIds: [data.documentId + ':body-1'], transform: { kind: 'translate', translationMillimeters: [distance, 0, 0] } })));
  const file = await request('library/create', { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: 'Legacy moves.acpart', data_base64: Buffer.from(JSON.stringify(data)).toString('base64') });
  await page.goto(`${origin}/cad/index.html?document=${file.id}`); await features().getByRole('treeitem', { name: /^Extrude/ }).first().waitFor({ timeout: 90000 });
  await button('Version control').click(); await page.getByRole('radio', { name: 'History', exact: true }).click();
  await page.locator('.cad-studio-view-tools').getByRole('button', { name: 'Fit view', exact: true }).click(); await button('Top view').press('Enter');
  await page.mouse.move(800, 450);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(80); }
  await page.waitForTimeout(300);
  const bar = () => history().getByRole('slider', { name: 'History rollback' });
  const treeBar = () => features().locator('.aui-tree-row--divider');
  const dragTo = async (index, cancel = false) => {
    const start = await bar().boundingBox();
    const row = await history().locator('[data-history-rollback-index="' + Math.min(index, 3) + '"]').boundingBox();
    const x = start.x + start.width / 2, y = index === 4 ? row.y + row.height + 4 : row.y + 2;
    await page.mouse.move(x, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await expect(bar()).toHaveAttribute('aria-valuenow', String(index));
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  const savedIndex = async () => (await read(file.id)).rollbackIndex ?? 4;
  await step('history-bar-matches-tree', async () => {
    await expect(bar()).toHaveAttribute('aria-valuenow', '4');
    const style = await bar().evaluate(el => {const s=getComputedStyle(el,'::after');return {height:s.height,color:s.backgroundColor};});
    const treeStyle = await treeBar().evaluate(el => {const s=getComputedStyle(el,'::after');return {height:s.height,color:s.backgroundColor};});
    assert.deepEqual(style, treeStyle); assert.equal(style.height, '5px');
    await expect.poll(() => solidAt([35,10,5])).toBe(true);
  });
  await step('drag-rolls-through-placement-action', async () => {
    await dragTo(3);
    await expect.poll(savedIndex).toBe(3);
    await expect(treeBar()).toContainText('3 / 4');
    await expect.poll(() => solidAt([25,10,5])).toBe(true);
    await expect.poll(() => solidAt([35,10,5])).toBe(false);
    assert.deepEqual((await read(file.id)).features, data.features);
    await expect(history().locator('[data-history-rollback-index="3"]')).toHaveAttribute('data-inactive','true');
  });
  await step('cancel-preserves-history-and-geometry', async () => {
    await dragTo(1, true); await expect(bar()).toHaveAttribute('aria-valuenow','3');
    assert.equal(await savedIndex(),3); await expect.poll(() => solidAt([25,10,5])).toBe(true);
  });
  await step('keyboard-start-end-and-tree-sync', async () => {
    await bar().press('Home'); await expect.poll(savedIndex).toBe(0);
    await expect(treeBar()).toContainText('0 / 4'); await expect(page.getByText('Parts (0)',{exact:true})).toBeVisible();
    await bar().press('End'); await expect.poll(savedIndex).toBe(4);
    await expect(treeBar()).toContainText('4 / 4'); await expect(page.getByText('Parts (1)',{exact:true})).toBeVisible();
    await treeBar().press('ArrowUp'); await expect.poll(savedIndex).toBe(3);
    await expect(bar()).toHaveAttribute('aria-valuenow','3');
    await bar().press('ArrowDown'); await expect.poll(savedIndex).toBe(4);
    await expect(treeBar()).toContainText('4 / 4');
  });
  await step('filter-and-save-reopen', async () => {
    const search=history().getByRole('searchbox'); await search.fill('Move parts'); await expect(bar()).toHaveCount(0);
    await search.fill(''); await expect(bar()).toHaveAttribute('aria-valuenow','4');
    await bar().press('ArrowUp'); await expect.poll(savedIndex).toBe(3);
    await page.reload(); await features().getByRole('treeitem',{name:/^Extrude/}).first().waitFor({timeout:90000});
    await expect(bar()).toHaveAttribute('aria-valuenow','3'); await expect(treeBar()).toContainText('3 / 4');
    assert.deepEqual((await read(file.id)).features,data.features);
    await bar().press('End'); await expect.poll(savedIndex).toBe(4);
    await writeFile(join(evidence,'saved-part.json'),JSON.stringify(await read(file.id),null,2));
  });
  assert.deepEqual(errors, []); assert.deepEqual(legacyRPC, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ steps, errors, legacyRPC }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), String(error.stack) + '\n' + JSON.stringify({ steps, errors })); throw error;
} finally { await browser.close(); }
