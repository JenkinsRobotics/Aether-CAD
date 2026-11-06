import { authorWithNativePicks } from './native-edge-picks.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectLiveAgent } from '../../browser/live-agent.mjs';
const recipeName = process.env.AETHER_AUTHOR_RECIPE ?? 'artemis-sls';
const model = (await import('./models/' + recipeName + '.mjs')).default;
import { partDocumentBase64, tabDocumentOf } from '../../browser/document-fixture.mjs';

const { chromium, expect } = createRequire(new URL('../../../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
const errors = [], steps = [], receipts = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname === '/api/cad/geometry') errors.push('Server geometry request'); });
const button = name => page.getByRole('button', { name, exact: true });
const tree = () => page.getByRole('tree', { name: 'CAD features', exact: true });
const row = name => tree().getByRole('treeitem', { name }).first();
const api = (action, data) => page.evaluate(async ({ action, data }) => {
  const response = await fetch('/api/library/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: 'cad', ...data }) });
  if (!response.ok) throw Error(await response.text()); return response.json();
}, { action, data });
const step = async (name, action) => {
  console.log('Begin ' + name);
  await writeFile(join(evidence, 'progress.json'), JSON.stringify({ active: name, completed: steps }));
  await action(); steps.push(name);
  await page.screenshot({ path: join(evidence, `${steps.length}-${name}.png`) });
  console.log('Passed ' + name);
};
let agent;
const invoke = async (name, args = {}) => {
  const result = await agent.invoke(name, args);
  receipts.push({ name, arguments: args, result });
  return result;
};
const volume = proof => proof.measurements.reduce((sum, b) => sum + b.volume_mm3, 0);
try {
  await page.goto(origin + '/cad/');
  await page.locator('input[name="username"]').fill('editor');
  await page.locator('input[name="password"]').fill('account-test-password-2026');
  await button('Sign in').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  if (process.env.AETHER_EXAMPLE_AUTHOR_ONLY === '1') {
    // Start empty. Every sketch/solid is made through the live editor's MCP tools.
    for (const key of (process.env.AETHER_AUTHOR_PARTS?.split(',') ?? (recipeName === 'artemis-sls' ? ['orion-deck', 'orion-capsule', 'solar-frame'] : model.parts.map(p => p.key)))) {
      const part = model.parts.find(p => p.key === key || (key === 'solar-frame' && p.name === 'Solar wing panel frame'));
      assert.ok(part, key);
      await step('live-author-' + key, async () => {
        const file = await api('create', { kind: 'file', scope: 'personal', operation_id: randomUUID(), name: part.name + '.aethercad',
          data_base64: partDocumentBase64({ format: 'aether-part', formatVersion: 22, documentId: randomUUID(), name: part.name, units: 'millimeter', features: [] }) });
        await page.goto(`${origin}/cad/index.html?document=${file.id}`);
        await expect(tree()).toBeVisible({ timeout: 90000 });
        agent = await connectLiveAgent(page, origin, file.id, 'Example author ' + key);
        assert.equal((await invoke('aether_cad_inspect')).total_features, 0);
        if (recipeName === 'reference-bracket') await authorWithNativePicks(part.steps, invoke);
        else await invoke('aether_cad_run_program', { program_json: JSON.stringify({ version: 1, steps: part.steps }) });
        const proof = await invoke('aether_cad_verify');
        assert.ok(volume(proof) > 0);
        const expected = JSON.parse(await readFile(new URL('../../../build/Example-Collection/' + model.id + '/evidence/' + part.key + '.json', import.meta.url), 'utf8'));
        const expectedVolume = volume(expected.verification);
        assert.ok(Math.abs(volume(proof) - expectedVolume) <= expectedVolume * 1e-6, 'Live authored solid must match the shipped recipe');
        assert.equal((await invoke('aether_cad_inspect')).total_features, part.steps.length);
        await expect.poll(async () => tabDocumentOf((await api('read', { id: file.id })).data_base64).features.length, { timeout: 30000 }).toBe(part.steps.length);
        if (recipeName !== 'artemis-sls') {
          const inspection = await invoke('aether_cad_inspect', { limit: 50 });
          const sketchID = inspection.features[0].id;
          const sketch = await invoke('aether_cad_sketch_inspect', { feature_id: sketchID });
          const dimension = sketch.profile.constraints.find(c => ['diameter','length','radius'].includes(c.kind) && c.value > 0);
          assert.ok(dimension, 'Each workshop Part needs an editable driving dimension');
          await invoke('aether_cad_sketch_dimension', { feature_id: sketchID, dimension_id: dimension.id, value: dimension.value * .99 });
          const changed = volume(await invoke('aether_cad_verify'));
          if (recipeName === 'reference-bracket') assert.ok(Math.abs(expectedVolume - changed - 60 * 6 * (dimension.value * .01)) < 1e-5, 'Bracket width must change the complete solid by the exact foot volume');
          assert.ok(Math.abs(changed - expectedVolume) > .01, 'Dimension edit must change real solid geometry');
          await page.keyboard.press('ControlOrMeta+z');
          assert.ok(Math.abs(volume(await invoke('aether_cad_verify')) - expectedVolume) < expectedVolume * 1e-6);
          await page.keyboard.press('ControlOrMeta+Shift+z');
          assert.ok(Math.abs(volume(await invoke('aether_cad_verify')) - changed) < changed * 1e-6);
          await expect.poll(async () => tabDocumentOf((await api('read', { id: file.id })).data_base64).features[0].profile.constraints.find(c => c.id === dimension.id).value).toBe(dimension.value * .99);
          if (part.key === 'elbow') {
            const path = inspection.features.find(f => f.type === 'profile' && f.name.startsWith('Route'));
            await invoke('aether_cad_sketch_dimension', { feature_id: path.id, dimension_id: 'inlet-length', value: 45 });
            const routed = volume(await invoke('aether_cad_verify'));
            const expectedAdded = Math.PI * 4 * (dimension.value * .99 / 2) * 5;
            assert.ok(Math.abs(routed - changed - expectedAdded) < expectedAdded * 1e-5, 'Route length edit must extend the hollow Sweep by the exact annular volume');
            await expect.poll(async () => tabDocumentOf((await api('read', { id: file.id })).data_base64).features.find(f => f.id === path.id).profile.constraints.find(c => c.id === 'inlet-length').value).toBe(45);
          }

        }
        await agent.dispose(); agent = null;
        await page.reload();
        await expect(row(new RegExp('^' + part.steps[0].arguments.feature_json.name))).toBeVisible({ timeout: 90000 });
        const saved = tabDocumentOf((await api('read', { id: file.id })).data_base64);
        assert.ok(saved.features.every(f => !f.type.startsWith('import')));
        await writeFile(join(evidence, key + '.part.json'), JSON.stringify(saved, null, 2));
      });
    }
  } else {
    const catalog = JSON.parse(await readFile(new URL('../../../public/examples/catalog.json', import.meta.url), 'utf8'));
    const example = catalog.find(e => e.id === 'artemis-sls');
    const assemblyID = example.configurations[1].id;
    await page.goto(`${origin}/cad/index.html?editor=1&example=artemis-sls&assembly=${assemblyID}`);
    let fileID, partID, sketchID, originalVolume;
    const project = async () => (await api('project_read', { id: fileID })).project;
    const source = async () => (await project()).parts.find(p => p.id === partID).document;
    await step('assembly-native-history-and-source-navigation', async () => {
      await expect(row(/^Equipment deck — sketch/)).toBeVisible({ timeout: 90000 });
      await expect(row(/^Crew module conical shell — section/)).toBeVisible();
      await expect(row(/^Panel backing — sketch/)).toBeVisible();
      await row(/^Equipment deck — sketch/).dblclick();
      await page.waitForURL(url => url.searchParams.has('part'));
      await expect(row(/^Equipment mounting holes — centers/)).toBeVisible();
      await expect(button('Save to My files')).toBeVisible();
      await button('Save to My files').click();
      await page.waitForURL(url => url.searchParams.has('document'), { timeout: 90000 });
      fileID = new URL(page.url()).searchParams.get('document');
      const deck = (await project()).parts.find(p => p.name === 'Service module equipment deck');
      partID = deck.id; sketchID = deck.document.features[0].id;
      assert.equal(new URL(page.url()).searchParams.get('part'), partID, 'Saving a source Part must keep it open for editing');
      await expect(row(/^Equipment deck — sketch/)).toBeVisible({ timeout: 90000 });
      agent = await connectLiveAgent(page, origin, fileID, 'Native example collaboration');
      originalVolume = volume(await invoke('aether_cad_verify'));
    });
    await step('human-sketch-dimension-agent-inspection', async () => {
      await row(/^Equipment deck — sketch/).dblclick();
      await expect(page.locator('.cad-sketch-window')).toBeVisible();
      await page.locator('.sketch-dimension[data-constraint-id="diameter-0"] text').dblclick();
      await page.getByRole('textbox', { name: 'Dimension value', exact: true }).fill('38.8');
      await button('Confirm dimension').click();
      await page.locator('.cad-sketch-window [data-feature-action="accept"]').click();
      await expect(page.locator('.cad-sketch-window')).toHaveCount(0, { timeout: 30000 });
      const sketch = await invoke('aether_cad_sketch_inspect', { feature_id: sketchID });
      assert.equal(sketch.profile.constraints.find(c => c.id === 'diameter-0').value, 38.8);
      const changedVolume = volume(await invoke('aether_cad_verify'));
      assert.ok(changedVolume < originalVolume - 1);
      await expect.poll(async () => (await source()).features[0].profile.constraints.find(c => c.id === 'diameter-0').value).toBe(38.8);
    });
    await step('agent-dimension-human-history-save-reopen', async () => {
      await invoke('aether_cad_sketch_dimension', { feature_id: sketchID, dimension_id: 'diameter-0', value: 39.2 });
      const after = volume(await invoke('aether_cad_verify'));
      assert.ok(after < originalVolume - 1);
      await page.keyboard.press('ControlOrMeta+z');
      assert.equal((await invoke('aether_cad_sketch_inspect', { feature_id: sketchID })).profile.constraints.find(c => c.id === 'diameter-0').value, 38.8);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      assert.equal((await invoke('aether_cad_sketch_inspect', { feature_id: sketchID })).profile.constraints.find(c => c.id === 'diameter-0').value, 39.2);
      await expect.poll(async () => (await source()).features[0].profile.constraints.find(c => c.id === 'diameter-0').value).toBe(39.2);
      await agent.dispose(); agent = null;
      await page.reload(); await expect(row(/^Equipment deck — sketch/)).toBeVisible({ timeout: 90000 });
      await row(/^Equipment deck — sketch/).dblclick();
      await expect(page.locator('.sketch-dimension[data-constraint-id="diameter-0"]')).toContainText('39.2');
      await page.locator('.cad-sketch-window [data-feature-action="accept"]').click();
      await expect(page.locator('.cad-sketch-window')).toHaveCount(0, { timeout: 30000 });
      await page.goto(`${origin}/cad/index.html?document=${fileID}&assembly=${assemblyID}`);
      await expect(row(/^Equipment deck — sketch/)).toBeVisible({ timeout: 90000 });
      assert.equal((await source()).features[0].profile.constraints.find(c => c.id === 'diameter-0').value, 39.2);
      await writeFile(join(evidence, 'edited-deck.part.json'), JSON.stringify(await source(), null, 2));
    });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed: true, steps, errors, receipts }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  await writeFile(join(evidence, 'failure.txt'), `${error.stack}\n${JSON.stringify({ steps, errors })}`);
  await writeFile(join(evidence, 'receipts-on-failure.json'), JSON.stringify(receipts, null, 2));
  throw error;
} finally { await browser.close(); }
