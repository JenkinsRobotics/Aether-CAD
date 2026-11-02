/** Release gate: opening CAD Home must never start a draft or create a file. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ??
  fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const evidence = process.env.AETHER_FRONTEND_EVIDENCE ?? resolve('build/home-navigation');
await mkdir(evidence, { recursive: true });
const frontend = process.env.AETHER_HOME_FRONTEND;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const requests = [], errors = [], checks = [];
let server, origin = process.env.AETHER_TEST_ORIGIN;
if (frontend) {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    try {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/status') return res.end(JSON.stringify({ name: 'Test Studio', user: { id: 'fixture', username: 'fixture' }, apps: [{ id: 'cad', name: 'Aether CAD', url: '/cad/', enabled: true }] }));
      if (url.pathname === '/api/library/list') return res.end('{"files":[]}');
      if (url.pathname === '/api/drive/context') return res.end('{"organizations":[],"workspaces":[]}');
      if (url.pathname.startsWith('/api/')) { res.statusCode = 501; return res.end('{"error":"Unexpected editor request on Home"}'); }
      if (url.pathname === '/suite/account.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(''); }
      const local = url.pathname.startsWith('/standalone/');
      const path = resolve(frontend, url.pathname.replace(/^\/(cad|standalone)\//, '') || 'index.html');
      if (!path.startsWith(resolve(frontend) + '/')) throw Error('Invalid fixture path');
      let bytes = await readFile(path);
      if (path.endsWith('/index.html') && !local) bytes = Buffer.from(bytes.toString().replace('</head>', '<script type="module" src="/suite/account.js"></script></head>'));
      res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream'); res.end(bytes);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
}
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Use a disposable test host');
assert.notEqual(new URL(origin).port, '8780');
const browser = await (process.env.AETHER_GATE_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.addInitScript(() => {
    window.showDirectoryPicker = () => { throw Error('Home requested local files without permission'); };
  });
  await page.goto(origin + '/cad/');
  if (!frontend) {
    await page.locator('input[name="username"]').fill('editor');
    await page.locator('input[name="password"]').fill('account-test-password-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible({ timeout: 20000 });
  }
  async function home(path) {
    const start = requests.length;
    await page.goto(origin + path);
    await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    assert.equal(new URL(page.url()).searchParams.has('draft'), false);
    assert.equal(await page.locator('#viewport').count(), 0);
    assert.equal(requests.slice(start).filter(r => /\/api\/library\/(create|save|project_create)$/.test(new URL(r.url).pathname)).length, 0);
    assert.equal(requests.slice(start).filter(r => /\/assets\/main-[^/]+\.js$/.test(new URL(r.url).pathname)).length, 0, 'Home loaded the editor controller');
    checks.push(path);
  }
  for (const path of ['/cad/', '/cad/index.html']) await home(path);
  if (frontend) {
    const start = requests.length;
    await home('/standalone/');
    assert.equal(requests.slice(start).filter(r => new URL(r.url).pathname.startsWith('/api/')).length, 0);
    await expect(page.getByRole('button', { name: 'Choose local folder', exact: true })).toBeVisible();
  } else {
    // The actual editor Home link must return to the library, including from
    // older recovery URLs that do not carry the newer editor flag.
    await page.goto(origin + '/cad/?draft=home-routing-recovery');
    await expect(page.locator('#viewport')).toBeVisible({ timeout: 60000 });
    await page.waitForLoadState('networkidle');
    assert.equal(new URL(page.url()).searchParams.get('draft'), 'home-routing-recovery');
    await page.reload();
    await expect(page.locator('#viewport')).toBeVisible({ timeout: 60000 });
    await page.getByRole('link', { name: 'Aether CAD home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible({ timeout: 20000 });
    assert.equal(new URL(page.url()).search, '');
    checks.push('draft-reload-and-editor-home');

    await page.getByRole('button', { name: 'Part Model exact solid geometry', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Home routing part');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByText('Home routing part.acpart', { exact: true }).first().dblclick();
    await expect(page.locator('#viewport')).toBeVisible({ timeout: 60000 });
    assert.ok(new URL(page.url()).searchParams.get('document'));
    await page.getByRole('link', { name: 'Aether CAD home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible({ timeout: 20000 });
    checks.push('explicit-create-open-and-home');
  }
  await home('/cad/');
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Examples', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get started', exact: true })).toBeVisible();
  checks.push('examples-and-home');
  await page.screenshot({ path: join(evidence, 'cad-home.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} finally { await browser.close(); if (server) await new Promise(done => server.close(done)); }
