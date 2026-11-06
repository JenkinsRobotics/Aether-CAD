/** Run against the disposable Studio browser fixture, never the installed host.
 * Set AETHER_TEST_ORIGIN and AETHER_FRONTEND_EVIDENCE. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDrawingAgent } from './verify-drawing-agent-browser.mjs';
import { drawingsOf, partDocumentBase64, partDocumentOf, tabDocumentOf } from './browser/document-fixture.mjs';
const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const { PDFDocument } = createRequire(new URL('../aether-engine/package.json', import.meta.url))('pdf-lib');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], steps = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (new URL(r.url()).pathname === '/api/cad/geometry') errors.push('Server geometry request'); });
const button = name => page.getByRole('button', { name, exact: true });
const step = async (name, action) => { console.log('Begin ' + name); await action(); steps.push(name); console.log('Passed ' + name); await page.screenshot({ path: join(evidence, `${steps.length}-${name}.png`) }); };
const add = async () => { await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 }); };
const drawing = async () => { await button('Workspace: Design').click(); await page.getByRole('menuitemradio', {name: 'Drawing', exact: true}).click(); await button('Base view').waitFor({ timeout: 60000 }); };
const save = async name => { await button('Save').click(); const pending = page.waitForEvent('download'); await button('Download drawing').click(); const download = await pending; const path = join(evidence, name); await download.saveAs(path); return tabDocumentOf((await readFile(path)).toString('base64')); };
const readSaved = id => page.evaluate(async id => { const r = await fetch('/api/library/read', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app:'cad',id})}); if(!r.ok)throw Error(await r.text());return r.json(); },id);
const checkPDF = async (bytes, sizes) => {
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), sizes.length);
  sizes.forEach(([width, height], index) => {
    assert.ok(Math.abs(pdf.getPage(index).getWidth() - width * 72 / 25.4) < 1e-8);
    assert.ok(Math.abs(pdf.getPage(index).getHeight() - height * 72 / 25.4) < 1e-8);
  });
};
const exportPDF = async (name, sizes, all = false) => {
  await button('Export Drawing').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: all ? 'PDF · All sheets' : 'PDF', exact: true }).click();
  const path = join(evidence, name + '.pdf');
  await (await pending).saveAs(path);
  await checkPDF(await readFile(path), sizes);
};
let file, saved, drawingFileId;
try {
  await page.goto(origin + '/cad/'); await page.locator('input[name="username"]').fill('editor'); await page.locator('input[name="password"]').fill('account-test-password-2026'); await button('Sign in').click();
  await page.getByText('A space for your next idea.', { exact: false }).waitFor({ timeout: 30000 });
  const doc = { format: 'aether-part', formatVersion: 21, documentId: randomUUID(), name: 'Drawing bracket', units: 'millimeter', features: [
    { id: 'profile', name: 'Rectangle', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: { type: 'polygon', pointsMillimeters: [[-20,-10],[20,-10],[20,10],[-20,10]] } },
    { id: 'extrude', name: 'Extrude', type: 'extrude', profileFeatureId: 'profile', suppressed: false, operation: 'new', distanceMillimeters: 12 },
    { id: 'bore', name: 'Bore', type: 'profile', plane: 'XY', offsetMillimeters: 12, suppressed: false, profile: { type: 'circle', centerMillimeters: [0,0], radiusMillimeters: 4 } },
    { id: 'cut', name: 'Bore cut', type: 'extrude', profileFeatureId: 'bore', suppressed: false, operation: 'cut', distanceMillimeters: 12 },
  ] };
  file = await page.evaluate(async data => { const response = await fetch('/api/library/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); if (!response.ok) throw Error(await response.text()); return response.json(); }, { app: 'cad', kind: 'file', scope: 'personal', operation_id: randomUUID(), name: doc.name + '.aethercad', data_base64: partDocumentBase64(doc) });
  // The part tray is closed by default and drawing mode hides its toggle; this flow creates the drawing tab from the tray.
  await page.evaluate(() => localStorage.setItem('aether-cad.file-tray-visible', 'true'));
  await page.goto(`${origin}/cad/index.html?document=${file.id}`);
  await page.getByRole('treeitem', { name: /Extrude/ }).first().waitFor({ timeout: 90000 });
  await step('base-and-projected-views', async () => {
    await drawing(); await button('Base view').click(); await page.locator('#drawing-x').fill('80'); await page.locator('#drawing-y').fill('110'); await add();
    await expect(page.locator('svg[data-sheet-id] [data-view-id]')).toHaveCount(1);
    await button('Base view').click(); await page.locator('#drawing-orientation').selectOption('top'); await page.locator('#drawing-parent').selectOption({ label: 'Front' }); await page.locator('#drawing-x').fill('80'); await page.locator('#drawing-y').fill('60'); await add();
    await expect(page.locator('svg[data-sheet-id] [data-view-id]')).toHaveCount(2);
    assert.ok(await page.locator('svg[data-sheet-id] [data-primitive-id]').count() > 8);
  });
  await step('exact-section-view-and-invalid-cut-refusal',async()=>{
    await button('Section view').click();await page.locator('#drawing-orientation').selectOption('top');
    await page.locator('#drawing-name').fill('Section A-A');await page.locator('#drawing-x').fill('185');await page.locator('#drawing-y').fill('100');
    await page.getByRole('checkbox',{name:'Section view',exact:true}).check();await page.locator('#drawing-cut-offset').fill('6');await page.locator('#drawing-hatch-spacing').fill('2');await add();
    await expect(page.locator('svg[data-sheet-id] [data-view-id]')).toHaveCount(3);
    assert.ok(await page.locator('svg[data-sheet-id] [data-primitive-id*="/hatch/"]').count()>5);
    await page.getByRole('treeitem',{name:/^Section A-A\b/}).first().click();await button('Edit selection').click();
    await page.locator('#drawing-cut-offset').fill('1000');await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('does not cross');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    const section=await save('section.aethercad');assert.equal(section.formatVersion,2);assert.equal(section.sheets[0].views.find(v=>v.name==='Section A-A').section.offsetMm,6);
  });
  await step('dimension-and-note', async () => {
    await button('Annotation').click(); await page.locator('#drawing-annotation-kind').selectOption('height'); await page.locator('#drawing-dimension-view').selectOption({ label: 'Front' }); await page.locator('#drawing-x').fill('115'); await page.locator('#drawing-y').fill('110'); await add();
    await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: /^12.00$/ })).toHaveCount(1);
    await button('Annotation').click(); await page.locator('#drawing-note').fill('Deburr <all> edges · Ø8 ±0.1 mm'); await page.locator('#drawing-x').fill('25'); await page.locator('#drawing-y').fill('170'); await add();
    saved = await save('before.aethercad'); assert.equal(saved.sheets[0].annotations.length, 2);
    // One document type: the Drawing is a tab of the Part's own document, and the Part tab is untouched.
    drawingFileId = new URL(page.url()).searchParams.get('document'); assert.equal(drawingFileId,file.id);
    // The Drawing tab autosaves into the document after the download; wait for it before comparing.
    await expect.poll(async () => tabDocumentOf((await readSaved(drawingFileId)).data_base64).sheets[0].annotations.length, { timeout: 30000 }).toBe(2);
    const stored = await readSaved(drawingFileId); assert.deepEqual(tabDocumentOf(stored.data_base64),saved);
    assert.equal(saved.sourceReference.fileId,file.id); assert.equal(partDocumentOf(stored.data_base64).features[1].distanceMillimeters,12);
  });
  await step('source-edit-and-associative-rebuild', async () => {
    await button('← 3D model').click(); await page.getByRole('treeitem', { name: /^Extrude\b/ }).first().dblclick();
    await page.locator('.cad-feature-dialog').getByLabel('Distance (mm)', { exact: true }).first().fill('24');
    await page.locator('.cad-feature-dialog [data-feature-action="accept"]').click();
    await expect(page.locator('.cad-feature-dialog')).toHaveCount(0, { timeout: 30000 });
    await drawing(); await expect(page.getByText('Source Part changed. Rebuild to update views and dimensions.', {exact: true})).toBeVisible(); await button('Rebuild').click();
    await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: /^24.00$/ })).toHaveCount(1, { timeout: 60000 });
    await page.keyboard.press('Meta+z'); await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: /^12.00$/ })).toHaveCount(1);
    await page.keyboard.press('Meta+Shift+z'); await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: /^24.00$/ })).toHaveCount(1);
  });
  await step('invalid-edit-keeps-drawing', async () => {
    await page.getByRole('treeitem', { name: /^Front\b/ }).first().click(); await button('Edit selection').click(); await page.locator('#drawing-scale').fill('0'); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('between'); await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('svg[data-sheet-id] [data-view-id]')).toHaveCount(3);
  });
  await step('exports-and-local-reopen', async () => {
    for (const format of ['SVG', 'DXF']) {
      await button('Export Drawing').click(); const pending = page.waitForEvent('download'); await page.getByRole('menuitem', { name: format, exact: true }).click(); const download = await pending; const path = join(evidence, 'sheet.' + format.toLowerCase()); await download.saveAs(path); const content = await readFile(path, 'utf8'); assert.ok(content.includes('24.00')); if (format === 'SVG') {assert.ok(content.includes('Deburr &lt;all&gt; edges'));assert.ok(content.includes('data-layer="hatch"'));}else assert.ok(content.includes('8\nHATCH\n'));
    }
    await exportPDF('sheet', [[297, 210]]);
    saved = await save('final.aethercad');
    await page.reload(); await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: /^24.00$/ })).toHaveCount(1, { timeout: 90000 });
    assert.equal(new URL(page.url()).searchParams.get('document'),drawingFileId);
    await page.locator('.cad-drawing-filebar input[type=file]').setInputFiles(join(evidence, 'final.aethercad'));
    await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: /^24.00$/ })).toHaveCount(1, { timeout: 60000 });
    const reopened = await save('reopened.aethercad'); assert.deepEqual(reopened, saved);
    assert.notEqual(new URL(page.url()).searchParams.get('document'),drawingFileId);
    assert.deepEqual(tabDocumentOf((await readSaved(drawingFileId)).data_base64),saved);
  });
  await step('multiple-sheets', async () => {
    await button('Add sheet').click(); await page.locator('#drawing-width').fill('210'); await page.locator('#drawing-height').fill('297'); await add();
    await expect(page.locator('svg[data-sheet-id]')).toHaveAttribute('viewBox', '0 0 210 297');
    await exportPDF('portrait', [[210, 297]]);
    await exportPDF('all-sheets', [[297, 210], [210, 297]], true);
    await page.getByRole('treeitem', { name: /Sheet 1\b/ }).first().click();
    await expect(page.locator('svg[data-sheet-id]')).toHaveAttribute('viewBox', '0 0 297 210');
    await expect(page.locator('svg[data-sheet-id] [data-view-id]')).toHaveCount(3);
  });
  await step('sheet-fits-workspace', async () => {
    for (const width of [1440, 1100]) {
      await page.setViewportSize({ width, height: 1000 });
      const stage = page.locator('.cad-drawing-paper-stage');
      await expect(stage).toBeVisible();
      await expect.poll(() => stage.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await button('← 3D model').click();
    await expect(page.getByRole('treeitem', { name: /^Extrude\b/ }).first()).toBeVisible();
    await drawing();
    await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: /^24.00$/ })).toHaveCount(1);
  });
  await step('point-dimensions-ui', async () => {
    for (const [kind, picks, text] of [
      ['point-distance', '60,50\n100,70', '44.72'],
      ['point-angle', '60,50\n100,50\n100,70', '90.00°'],
    ]) {
      await button('Annotation').click();
      await page.locator('#drawing-annotation-kind').selectOption(kind);
      await page.locator('#drawing-dimension-view').selectOption({ label: 'Top' });
      await page.locator('#drawing-point-picks').fill(picks);
      await page.locator('#drawing-x').fill('125'); await page.locator('#drawing-y').fill('75');
      await add();
      await expect(page.locator('svg[data-sheet-id] text').filter({ hasText: text })).toHaveCount(1);
    }
    const points = await save('point-dimensions.aethercad');
    assert.equal(points.formatVersion, 5);
    assert.equal(points.sheets[0].annotations.filter(a => a.kind.startsWith('point-')).length, 2);
    await exportPDF('point-dimensions', [[297, 210]]);
  });
  await step('dimension-chain-edit-and-history', async () => {
    await button('Annotation').click();
    await page.locator('#drawing-annotation-kind').selectOption('chain');
    await page.locator('#drawing-dimension-view').selectOption({ label: 'Top' });
    await page.locator('#drawing-point-picks').fill('60,50\n100,50\n100,70');
    await page.locator('#drawing-x').fill('80'); await page.locator('#drawing-y').fill('35');
    await add();
    const chain = await save('dimension-chain.aethercad');
    const members = chain.sheets[0].annotations.filter(a=>a.kind==='point-distance' && /\/[12]$/.test(a.id));
    assert.equal(members.length,2);
    await page.keyboard.press('Meta+z');
    assert.equal((await save('chain-undone.aethercad')).sheets[0].annotations.length,chain.sheets[0].annotations.length-2);
    await page.keyboard.press('Meta+Shift+z');
    assert.deepEqual((await save('chain-redone.aethercad')).sheets[0].annotations,chain.sheets[0].annotations);
  });
  await step('live-drawing-agent', async () => { await verifyDrawingAgent(page, origin, async bytes => {
      await writeFile(join(evidence, 'agent.pdf'), bytes);
      await checkPDF(bytes, [[297, 210], [210, 297]]);
    }); });
  await step('saved-and-read-only-drawing', async () => {
    await button('Save').click();
    const id = new URL(page.url()).searchParams.get('document'), stored = await readSaved(id);
    const original = partDocumentOf((await readSaved(file.id)).data_base64); assert.equal(original.features[1].distanceMillimeters,24);
    // A revision address names the Drawing tab; without it the document opens on its Part Studio.
    const drawingTab = (await page.evaluate(async id => { const r = await fetch('/api/library/project_read', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app:'cad',id})}); if(!r.ok)throw Error(await r.text());return r.json(); }, id)).project.drawings[0].id;
    await page.goto(`${origin}/cad/index.html?document=${id}&drawing=${drawingTab}&revision=${stored.revision}`);
    await expect(page.locator('svg[data-sheet-id] text').filter({hasText:'Agent-verified note'})).toHaveCount(1,{timeout:90000});
    await expect(page.getByText('Read-only drawing',{exact:true})).toBeVisible();
    await exportPDF('read-only', [[297, 210], [210, 297]], true);
    assert.equal((await readSaved(id)).revision, stored.revision);
    await button('Annotation').click(); await expect(page.getByRole('alert')).toContainText('read-only');
    await page.getByRole('treeitem',{name:/Sheet 2\b/}).first().click();
    await expect(page.locator('svg[data-sheet-id]')).toHaveAttribute('viewBox','0 0 210 297');
    await page.getByRole('treeitem',{name:/Sheet 1\b/}).first().click();
    await expect(page.locator('svg[data-sheet-id] text').filter({hasText:'Agent-verified note'})).toHaveCount(1);
    assert.equal((await readSaved(id)).revision,stored.revision);
  });
  await step('drawing-tab-and-metadata', async () => {
    // Drawings are tabs of the document: back in the Part's document, add one from the Files panel.
    const id=file.id;
    await page.goto(`${origin}/cad/index.html?document=${id}`); await page.getByRole('treeitem', { name: /^Extrude\b/ }).first().waitFor({ timeout: 90000 });
    if (!await page.getByRole('region',{name:'Files navigation',exact:true}).isVisible()) await button('Files').click();
    const panel=page.getByRole('region',{name:'Files navigation',exact:true});
    await panel.getByRole('button',{name:'Create in this design',exact:true}).click(); await page.getByRole('menuitem',{name:'Create Drawing…',exact:true}).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Manufacturing drawing'); await page.getByRole('dialog').getByRole('button',{name:'Create',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:60000});
    await expect(page.getByText('Manufacturing drawing',{exact:true}).first()).toBeVisible({timeout:60000});
    const byName=(base64)=>drawingsOf(base64).find(d=>d.name==='Manufacturing drawing');
    await expect.poll(async()=>Boolean(byName((await readSaved(id)).data_base64)),{timeout:30000}).toBe(true);
    const doc=byName((await readSaved(id)).data_base64); assert.equal(doc.sourceReference.fileId,file.id);
    const request=(action,data)=>page.evaluate(async({action,data})=>{const r=await fetch('/api/library/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app:'cad',...data})});const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value;},{action,data});
    const meta=await request('cad_metadata',{id}); assert.ok(meta.items.some(i=>i.kind==='drawing'&&i.name==='Manufacturing drawing'));
    const renamed=await request('cad_operation',{id,operation:'rename',name:'Released drawing',expected_revision:meta.revision,operation_id:randomUUID()});
    // Renaming through cad_operation renames the document; its Drawing tabs keep their names and sources.
    const renamedStored=await readSaved(id); assert.equal(renamedStored.name,'Released drawing.aethercad'); assert.deepEqual(byName(renamedStored.data_base64).source,doc.source);
    const copy=await request('cad_operation',{id,operation:'copy',name:'Drawing copy',parent:null,expected_revision:renamed.revision,operation_id:randomUUID()});
    assert.notEqual(copy.id,id);assert.deepEqual(byName((await readSaved(copy.id)).data_base64).sourceReference,doc.sourceReference);
    await page.reload(); await expect(page.locator('svg[data-sheet-id]')).toBeVisible({timeout:60000});
    assert.equal((await readSaved(id)).name,'Released drawing.aethercad');
  });
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ status: 'passed', steps, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png') }); await writeFile(join(evidence, 'failure.txt'), String(error.stack) + '\n' + await page.locator('body').innerText()); throw error;
} finally { await browser.close(); }
