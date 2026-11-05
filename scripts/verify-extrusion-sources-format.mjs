/** Old readers must refuse the output identity intent before interpreting it. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.argv[2], 'Provide the previous Part23 worker manifest');
const manifestPath = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(manifestPath));
const archive = resolve(dirname(manifestPath), manifest.entry);
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), manifest.sha256);
const temporary = mkdtempSync(join(tmpdir(), 'aether-extrusion-format-'));
const current = fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.mjs', import.meta.url));
const document = { format: 'aether-part', formatVersion: 23, documentId: 'output-version', name: 'Output identity', units: 'millimeter', features: [
  ...[-12,12].map((x,i) => ({ id: i ? 'b' : 'a', name: 'Sketch', type: 'profile', suppressed: false, plane: 'XY', offsetMillimeters: 0,
    profile: { type: 'drawing', contours: [{ id: 'circle', type: 'circle', center: [x,0], radius: 4 }] } })),
  { id: 'e', name: 'Extrude', type: 'extrude', suppressed: false, operation: 'new', profileFeatureId: 'a', separateBodies: true,
    profileSelections: [{ profileFeatureId: 'a', profileContourId: 'circle' }], distanceMillimeters: 5 },
] };
function run(entry, document) {
  const result = spawnSync(process.execPath, [entry], { input: JSON.stringify({ phase: 'build', content: JSON.stringify(document) }), encoding: 'utf8', timeout: 30000, maxBuffer: 10*1024*1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
try {
  execFileSync(process.env.AETHER_BUILD_PYTHON || 'python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, temporary]);
  const prior = join(temporary, 'aether_cad_service/runtime/runner.mjs');
  const old = run(prior, document), migrated = run(current, document);
  assert.equal(old.status, 'ok', JSON.stringify(old)); assert.equal(migrated.status, 'ok', JSON.stringify(migrated));
  assert.deepEqual(migrated.bodies.map(body=>[body.id,body.bbox_mm]),old.bodies.map(body=>[body.id,body.bbox_mm]));
  const multiple = structuredClone(document); multiple.formatVersion = 24;
  multiple.features[2].outputProfileId = 'a';
  multiple.features[2].profileSelections.push({profileFeatureId:'b',profileContourId:'circle'});
  const before = run(current, multiple); assert.equal(before.status, 'ok', JSON.stringify(before)); assert.equal(before.bodies.length,2);
  const expected = before.bodies.find(body=>body.bbox_mm[0][0]>0);
  const removed = structuredClone(multiple); removed.features[2].profileFeatureId = 'b'; removed.features[2].profileSelections.shift();
  const after = run(current, removed); assert.equal(after.status, 'ok', JSON.stringify(after));
  assert.equal(after.bodies.length,1); assert.equal(after.bodies[0].id,expected.id); assert.deepEqual(after.bodies[0].bbox_mm,expected.bbox_mm);
  for (const doc of [multiple,removed]) {
    const refused = run(prior,doc); assert.notEqual(refused.status,'ok'); assert.match(JSON.stringify(refused), /Unsupported Part format version.*24/);
  }
  console.log('PASS prior Part23 output identity preserved; Part24 multi-source identity survives removal; prior worker refuses new intent');
} finally { rmSync(temporary,{recursive:true,force:true}); }
