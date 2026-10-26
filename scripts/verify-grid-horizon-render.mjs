/** Real shader compilation and pixel checks; no account or document access. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
const require = createRequire(new URL('../../AetherStudio/core/files/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const evidence = join(process.cwd(), '.verification/grid-horizon-2026-10-26/render');
await mkdir(evidence, { recursive: true });
const vite = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'grid-test-page', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (!req.url.startsWith('/grid-check')) return next();
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><script type="module" src="/scripts/browser/grid-horizon-scene.ts"></script>');
  });
} }] });
await vite.listen();
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const errors = [], results = [];
async function bands(page, bytes, theme) {
 return page.evaluate(async ({ encoded, theme }) => {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
  const png = context.getImageData(0, 0, canvas.width, canvas.height), bg = theme === 'dark' ? [16, 17, 18] : [242, 245, 247];
  const values = [];
  for (let band = 0; band < 8; band++) {
    let sum = 0, count = 0; const contrast = [];
    for (let y = band * 100; y < (band + 1) * 100; y++) for (let x = 100; x < 900; x++) {
      const i = (y * png.width + x) * 4;
      const d = Math.max(...bg.map((c, k) => Math.abs(png.data[i + k] - c)));
      contrast.push(d); sum += d; if (d >= 3) count++;
    }
    contrast.sort((a,b) => a-b);
    values.push({ peak: contrast[Math.floor(contrast.length * .99)], mean: sum / 80000, visible: count / 80000 });
  }
  bitmap.close(); return values;
 }, { encoded: bytes.toString('base64'), theme });
}
try {
 for (const backend of ['webgpu', 'webgl']) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/grid-check${backend === 'webgl' ? '?webgl' : ''}`);
  await page.waitForFunction(() => window.gridCheck, { timeout: 60000 });
  for (const theme of ['dark', 'light']) for (const projection of ['perspective', 'orthographic']) {
    for (const distance of [160, 1600, 16000]) {
      const options = { theme, projection, distance, axes: false };
      const renderer = await page.evaluate(options => window.gridCheck.render(options), options);
      const bytes = await page.screenshot({ path: join(evidence, `${backend}-${theme}-${projection}-${distance}.png`) });
      const pixels = await bands(page, bytes, theme);
      assert.ok(pixels[6].visible > .01, `${backend}/${theme}/${projection}/${distance}: foreground grid must stay visible`);
      if (projection === 'perspective') assert.ok(pixels[0].peak < pixels[6].peak * .5, 'grid must fade near the horizon');
      results.push({ ...options, renderer, pixels });
    }
  }
  for (const options of [
    { elevation: 90, distance: 16000, projection: 'orthographic', theme: 'light', pan: 500000 },
    { elevation: 3, distance: 16000, theme: 'light' },
    { elevation: 22, distance: 160, theme: 'dark', width: 3, model: true },
    { elevation: 22, distance: 16000, theme: 'dark', up: 'y', pan: -500000 },
  ]) {
    await page.evaluate(options => window.gridCheck.render(options), options);
    await page.screenshot({ path: join(evidence, `${backend}-extra-${results.length}.png`) }); results.push(options);
  }
  await page.close();
 }
 assert.deepEqual(errors, []);
 await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
 console.log(`Passed ${results.length} rendered grid views across both backends, themes and projections.`);
} finally { await browser.close(); await vite.close(); }
