const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./server.cjs');
const path = require('node:path');
test('local runtime serves WASM and rejects foreign origins and unknown services', async () => {
  const runtime = await startServer({ root: path.resolve('dist'), service: '/not-used', node: process.execPath });
  try {
    assert.equal((await fetch(runtime.origin)).status, 200);
    const mounted=await fetch(runtime.origin+'/cad/index.html?document=part',{redirect:'manual'});
    assert.equal(mounted.status,302);
    assert.equal(mounted.headers.get('location'),'/cad/index.html?document=part&storage=local');
    assert.equal((await fetch(runtime.origin+'/cad/?storage=local')).status,200);
    assert.equal((await fetch(runtime.origin+'/cad/examples/catalog.json')).status,200);
    assert.equal((await fetch(runtime.origin, { headers: { origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(runtime.origin + '/api/library/read')).status, 404);
    assert.equal((await fetch(runtime.origin + '/api/cad/engine', { method:'POST', body:'{}' })).status, 415);
    assert.equal((await fetch(runtime.origin + '/%2e%2e%2fpackage.json')).status, 403);
  } finally { runtime.close(); }
});
