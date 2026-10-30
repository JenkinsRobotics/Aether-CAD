import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = createRequire(new URL('../../../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const origin = process.env.AETHER_TEST_ORIGIN, evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const login = await browser.newPage();
await login.goto(origin + '/cad/');
await login.locator('input[name="username"]').fill('editor');
await login.locator('input[name="password"]').fill('account-test-password-2026');
await login.getByRole('button', { name: 'Sign in', exact: true }).click();
await login.waitForLoadState('networkidle');
const storageState = await login.context().storageState();
const catalog = await (await login.request.get(origin + '/cad/examples/catalog.json')).json();
const results = [];
try {
  for (const id of (process.env.AETHER_PROFILE_EXAMPLES ?? 'wrench,artemis-sls,scifirobot').split(',')) {
    const example = catalog.find(e => e.id === id);
    const assembly = example.configurations?.[id === 'artemis-sls' ? 1 : 0]?.id ?? example.assemblyId;
    const expected = example.configurations?.find(c => c.id === assembly)?.instances ?? example.instances;
    const context = await browser.newContext({ storageState, viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('aether-cad.metrics-overlay', 'on');
      window.openProfile = { workers: [], geometry: [], longTasks: [] };
      new PerformanceObserver(list => window.openProfile.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, ms: e.duration })))).observe({ type: 'longtask', buffered: true });
      const Original = Worker;
      window.Worker = class extends Original {
        constructor(...args) {
          super(...args);
          const record = { url: String(args[0]), created: performance.now(), messages: [] };
          window.openProfile.workers.push(record);
          this.addEventListener('message', e => record.messages.push({ direction: 'in', type: e.data.type, id: e.data.requestId, at: performance.now(), bodies: e.data.model?.parts?.length, buildMs: e.data.model?.parseMilliseconds }));
          const post = this.postMessage.bind(this);
          this.postMessage = (...values) => { const m = values[0]; record.messages.push({ direction: 'out', type: m.type, id: m.requestId, at: performance.now(), name: m.document?.name, features: m.document?.features?.length }); return post(...values); };
        }
      };
      const observe = () => {
        let previous = '';
        new MutationObserver(() => {
          const rows = [...document.querySelectorAll('.cad-metrics-overlay > div')];
          const values = Object.fromEntries(rows.map(r => [r.querySelector('span')?.textContent, r.querySelector('strong')?.textContent]));
          const key = [values.BODIES, values.TRIS].join('/');
          if (key !== previous) { previous = key; window.openProfile.geometry.push({ at: performance.now(), ...values }); }
        }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      };
      if (document.documentElement) observe(); else document.addEventListener('DOMContentLoaded', observe);
    });
    for (const mode of ['cold', 'repeat']) {
      const profiler = process.env.AETHER_PROFILE_CPU ? await context.newCDPSession(page) : null;
      if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
      const requests = [], errors = [];
      const onRequest = request => { if (request.url().includes('/api/cad/assembly')) { const data = request.postDataJSON(); requests.push({ method: data.method, start: Date.now(), request }); } };
      const onResponse = response => { const entry = requests.find(r => r.request === response.request()); if (entry) entry.ms = Date.now() - entry.start; };
      const onError = e => errors.push(e.message);
      page.on('request', onRequest); page.on('response', onResponse); page.on('pageerror', onError);
      console.log('Opening', id, mode, expected);
      await page.goto(`${origin}/cad/index.html?editor=1&example=${id}&assembly=${assembly}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(count => Number([...document.querySelectorAll('.cad-metrics-overlay > div')].find(e => e.querySelector('span')?.textContent === 'BODIES')?.querySelector('strong')?.textContent) >= count, expected, { timeout: 150000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const profile = await page.evaluate(() => ({ ...window.openProfile, completed: performance.now(), resources: performance.getEntriesByType('resource').map(e => ({ name: e.name.replace(location.origin, ''), start: e.startTime, ms: e.duration, bytes: e.transferSize })) }));
      if (profiler) { await writeFile(join(evidence, `${id}-${mode}.cpuprofile`), JSON.stringify((await profiler.send('Profiler.stop')).profile)); await profiler.detach(); }
      await page.screenshot({ path: join(evidence, `${id}-${mode}.png`) });
      results.push({ id, mode, expected, ...profile, requests: requests.map(({ request, ...r }) => r), errors });
      await writeFile(join(evidence, 'opening.json'), JSON.stringify(results, null, 2));
      console.log('Visible', id, mode, profile.completed, 'ms', requests.map(r => `${r.method}:${r.ms}`).join(', '));
      assert.deepEqual(errors, []);
      if (process.env.AETHER_EXPECT_DISPLAY_CACHE && mode === 'repeat') {
        assert.equal(profile.workers.flatMap(w => w.messages).filter(m => m.direction === 'out' && m.type === 'evaluate-part').length, 0, 'Unchanged native sources must reuse verified display geometry across reloads');
        assert.equal(requests.length, 4, 'Open only the requested configuration');
      }
      page.off('request', onRequest); page.off('response', onResponse); page.off('pageerror', onError);
    }
    await context.close();
  }
} finally { await browser.close(); }
