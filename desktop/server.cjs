const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/** Loopback transport only. It never accepts a filesystem path from a document. */
async function startServer({ root, service, node, port = 0 }) {
  const children = new Set();
  let origin;
  const server = http.createServer(async (request, response) => {
    const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply(403, { error: 'Only the desktop window can use this runtime.' });
    }
    try {
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (!/^\/api\/cad\/(assembly|assembly-compose|mate-kinds|engine|project-(create|read|edit)|settings-(read|edit))$/.test(url.pathname)) return reply(404, { error: 'Service unavailable offline.' });
        if (request.method !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return reply(415, { error: 'Use a JSON POST request.' });
        if (children.size >= 4) return reply(429, { error: 'CAD is busy. Retry shortly.' });
        let bytes = 0; const chunks = [];
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) return reply(413, { error: 'CAD request too large.' }); chunks.push(chunk); }
        const arguments_ = JSON.parse(Buffer.concat(chunks));
        const child = spawn(service, [node], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
        children.add(child);
        let done = false, output = '', length = 0;
        const finish = (status, body) => { if (done) return; done = true; clearTimeout(timer); children.delete(child); reply(status, body); };
        const timer = setTimeout(() => { child.kill(); finish(504, { error: 'CAD operation timed out.' }); }, 60000);
        child.stdout.on('data', chunk => { length += chunk.length; if (length > 16 * 1024 * 1024) { child.kill(); finish(502, { error: 'CAD response too large.' }); } else output += chunk; });
        child.stderr.resume();
        child.stdin.on('error', () => {});
        child.on('error', () => finish(503, { error: 'Cannot start the bundled CAD runtime.' }));
        child.on('close', code => { try { if (code) throw Error(); const result = JSON.parse(output); finish(result.status, result.body); } catch { finish(502, { error: 'CAD operation failed.' }); } });
        child.stdin.end(JSON.stringify({ service: url.pathname, arguments: arguments_ }));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return reply(405, { error: 'Method not allowed.' });
      // Match the hosted product mount, but explicitly retain local storage.
      // Old links and detached windows must never turn into Studio requests.
      if (['/cad', '/cad/', '/cad/index.html'].includes(url.pathname) && url.searchParams.get('storage') !== 'local') {
        url.searchParams.set('storage','local');
        response.writeHead(302,{Location:(url.pathname === '/cad' ? '/cad/' : url.pathname)+url.search});
        response.end(); return;
      }
      if (url.pathname.startsWith('/cad/')) url.pathname = url.pathname.slice(4);

      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(path.resolve(root) + path.sep)) return reply(403, { error: 'Invalid path.' });
      const contents = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) { reply(error.code === 'ENOENT' ? 404 : 400, { error: 'Unable to read this local resource.' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => { children.forEach(child => child.kill()); server.close(); } };
}
module.exports = { startServer };
