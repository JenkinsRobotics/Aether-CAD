// Real native documents and actual UI interaction on the disposable Studio host.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { partDocumentBase64, tabDocumentOf } from './browser/document-fixture.mjs';
const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
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
  const doc = base('Revolve intersection browser qualification');
  doc.features = [sketch('block-sketch','XY',[[-10,-10],[10,-10],[10,10],[-10,10]]),
    {id:'block',type:'extrude',name:'Block',profileFeatureId:'block-sketch',distanceMillimeters:10,operation:'new',bodyId:'block-body',suppressed:false},
    {...sketch('section','XZ',[[0,4],[40,4],[40,6],[0,6]]),name:'Section sketch'},
    {id:'revolve',type:'revolve',name:'Revolve intersection',profileFeatureId:'section',axis:'Z',angleDegrees:360,operation:'cut',targetBodyId:'block-body',suppressed:false}];
  const file = await open(doc);
  await row(/^Revolve intersection/).dblclick();
  await expect(dialog().getByRole('button',{name:'Intersect',exact:true})).toBeEnabled();
  await dialog().getByRole('button',{name:'Intersect',exact:true}).click();
  await expect(dialog().locator('[aria-label="Operation"]')).toHaveValue('intersect');
  await expect.poll(() => page.evaluate(() => {
    const model=window.__qualificationPreview;
    if(!model)return null;
    const parts=model.featurePreview?.added ?? model.parts;
    let lo=Infinity,hi=-Infinity;
    for(const part of parts)for(let i=2;i<part.vertices.length;i+=3){lo=Math.min(lo,part.vertices[i]);hi=Math.max(hi,part.vertices[i]);}
    return [Number(lo.toFixed(4)),Number(hi.toFixed(4))];
  }),{timeout:45000}).toEqual([4,6]);
  await accept();
  await expect.poll(async () => (await stored(file.id)).features.at(-1).operation,{timeout:30000}).toBe('intersect');
  assert.equal((await stored(file.id)).formatVersion,29);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await stored(file.id)).features.at(-1).operation,{timeout:30000}).toBe('cut');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await stored(file.id)).features.at(-1).operation,{timeout:30000}).toBe('intersect');
  await page.reload();
  await row(/^Revolve intersection/).dblclick();
  await expect(dialog().locator('[aria-label="Operation"]')).toHaveValue('intersect');
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({timeout:45000});
  await page.screenshot({path:join(evidence,'revolve-intersect.png')});
  await dialog().locator('[data-feature-action="discard"]').click();
  results.push('Native Revolve Intersect: editor switch, valid preview, apply, undo/redo, server save and reopened editable feature');
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'results.json'),JSON.stringify({results,errors},null,2));
  console.log(results.join('\n'));
} catch(error) {
  await page.screenshot({path:join(evidence,'failure.png')});
  await writeFile(join(evidence,'failure.txt'),`${error.stack}\n${await dialog().allTextContents()}`);
  throw error;
} finally { await browser.close(); }
