/** A reopened Part's first edit replays only its tail: production worker, real IndexedDB, a page
 *  reload between opening and editing. Damaged, obsolete and unavailable storage replay fully
 *  and build the same result. Run from the CAD repository. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { build, preview } from 'vite';
const { chromium } = createRequire(new URL('../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const evidence = process.env.AETHER_REPLAY_EVIDENCE ?? 'build/replay-reopen';
await mkdir(evidence, { recursive: true });
const outDir = `${evidence}/dist`;
await build({ configFile: false, logLevel: 'warn', worker: { format: 'es' }, base: './',
  build: { outDir, emptyOutDir: true, rollupOptions: { input: 'scripts/browser/replay-reopen.html' } } });
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
const url = `${server.resolvedUrls.local[0]}scripts/browser/replay-reopen.html`;

const graph = JSON.parse(execFileSync('unzip', ['-p', 'public/examples/scifirobot.aethercad.bin', 'state/graph.json'], { maxBuffer: 1 << 28 }));
const front = graph.part_definitions.find(p => p.feature_document?.name === 'Front shell').feature_document;
const edited = structuredClone(front);
edited.features.at(-2).offsetMillimeters = 1.6; // the gasket plane, as in the native comparison
const sketches = front.features.slice(0, -2).filter(f => f.type === 'profile' || f.type === 'sketch').length;

const browser = await chromium.launch({ headless: true });
const results = {}, errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const open = async () => { await page.goto(url); await page.waitForFunction(() => window.replayCheck); await page.evaluate(() => window.replayCheck.ready); };
  const evaluate = document => page.evaluate(d => window.replayCheck.evaluate(d), document);
  const savedAfterBuild = async () => { for (let i = 0; i < 120; i++) { if (await page.evaluate(() => window.replayCheck.saved()) > 0) return; await page.waitForTimeout(500); } throw new Error('No replay snapshot was saved'); };

  await open(); await page.evaluate(() => window.replayCheck.clear()); await open();
  results.coldEdit = await evaluate(edited);                       // reference: an edit without any snapshot
  assert.equal(results.coldEdit.replayed, front.features.length);
  await page.evaluate(() => window.replayCheck.clear()); await open();
  results.open = await evaluate(front);
  await savedAfterBuild();
  await open();                                                    // reopen: a new page and worker
  results.reopenedEdit = await evaluate(edited);
  assert.equal(results.reopenedEdit.replayed, sketches + 2, 'Only sketches and the changed tail replay');
  assert.deepEqual(results.reopenedEdit.signature, results.coldEdit.signature);

  for (const mode of ['damage', 'obsolete', 'block']) {
    await page.evaluate(() => window.replayCheck.clear()); await open();
    await evaluate(front); await savedAfterBuild(); await open();
    await page.evaluate(m => window.replayCheck[m](), mode);
    results[mode] = await evaluate(edited);
    assert.equal(results[mode].replayed, front.features.length, `${mode}: replay every feature`);
    assert.deepEqual(results[mode].signature, results.coldEdit.signature, `${mode}: same result`);
  }
  assert.deepEqual(errors, []);
  const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ms: Math.round(v.ms), replayed: v.replayed }]));
  console.log(JSON.stringify(summary));
  await writeFile(`${evidence}/results.json`, JSON.stringify({ url, features: front.features.length, sketchesBeforeEdit: sketches, summary, results, errors }, null, 2));
} finally { await browser.close(); await new Promise(r => server.httpServer.close(r)); }
