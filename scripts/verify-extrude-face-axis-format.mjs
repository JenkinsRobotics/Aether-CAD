/** Released readers must refuse native face-axis direction references before interpreting them. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.ok(process.argv[2], 'Provide the released Part27 worker manifest');
const path = resolve(process.argv[2]), manifest = JSON.parse(readFileSync(path));
const archive = resolve(dirname(path), manifest.entry);
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), manifest.sha256);
const temp = mkdtempSync(join(tmpdir(), 'aether-face-axis-format-'));
const current = fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.mjs', import.meta.url));
const old = { format: 'aether-part', formatVersion: 27, documentId: 'direction', name: 'Direction', units: 'millimeter', features: [
  { id: 'guide-profile', type: 'profile', name: 'Guide sketch', suppressed: false, plane: 'XY', offsetMillimeters: 0,
    frame: { originMillimeters: [30, 0, 0], normal: [.6, 0, .8], xDirection: [.8, 0, -.6] },
    profile: { type: 'circle', radiusMillimeters: 5, centerMillimeters: [0, 0] } },
  { id: 'guide', type: 'extrude', name: 'Guide', suppressed: false, profileFeatureId: 'guide-profile', bodyId: 'guide-body', operation: 'new', distanceMillimeters: 10 },
  { id: 's', type: 'profile', name: 'Sketch', suppressed: false, plane: 'XY', offsetMillimeters: 0, profile: { type: 'circle', radiusMillimeters: 5, centerMillimeters: [0, 0] } },
  { id: 'e', type: 'extrude', name: 'Extrude', suppressed: false, operation: 'new', profileFeatureId: 's', bodyId: 'body', distanceMillimeters: 10 },
] };
function run(entry, document) {
  const result = spawnSync(process.execPath, [entry], { input: JSON.stringify({ phase: 'build', content: JSON.stringify(document) }), encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error)); return JSON.parse(result.stdout);
}
try {
  execFileSync(process.env.AETHER_BUILD_PYTHON || 'python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, temp]);
  const prior = join(temp, 'aether_cad_service/runtime/runner.mjs');
  const before = run(prior, old), after = run(current, old);
  assert.equal(before.status, 'ok', JSON.stringify(before)); assert.equal(after.status, 'ok', JSON.stringify(after));
  assert.deepEqual(after.bodies.map(b => [b.id, b.bbox_mm]), before.bodies.map(b => [b.id, b.bbox_mm]));
  const next = structuredClone(old); next.formatVersion = 28;
  next.features.at(-1).directionReference = { kind: 'face-axis', sourceFeatureId: 'guide', bodyId: 'guide-body', surfaceType: 'cylinder', label: 'Axis' };
  const directed = run(current, next); assert.equal(directed.status, 'ok', JSON.stringify(directed));
  assert.ok(Math.abs(directed.bodies.find(b => b.id === 'body').bbox_mm[1][2] - 8) < 1e-5);
  const refused = run(prior, next); assert.notEqual(refused.status, 'ok');
  assert.match(JSON.stringify(refused), /Unsupported Part format version.*28/);
  console.log('PASS Part27 geometry unchanged; Part28 face axis builds natively; released Part27 reader refuses new intent');
} finally { rmSync(temp, { recursive: true, force: true }); }
