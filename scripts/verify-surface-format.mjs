/** Prove the previous shipped reader refuses Surface's new geometry fields.
 * Usage: node scripts/verify-surface-format.mjs /path/to/previous/native-worker.json
 * Both workers execute locally against disposable inputs, never a live file. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.argv[2], 'Provide the previous released worker manifest');
const manifestPath = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(manifestPath));
const archive = resolve(dirname(manifestPath), manifest.entry);
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), manifest.sha256);
const temporary = mkdtempSync(join(tmpdir(), 'aether-surface-format-'));
const current = fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.mjs', import.meta.url));
const document = { format: 'aether-part', formatVersion: 23, documentId: 'surface-version', name: 'Surface version', units: 'millimeter', features: [
  { id: 's', name: 'Curve', type: 'profile', suppressed: false, plane: 'XY', offsetMillimeters: 0,
    profile: { type: 'drawing', contours: [{ id: 'line', type: 'path', start: [-5, 0], segments: [{ type: 'line', end: [5, 0] }] }] } },
  { id: 'e', name: 'Sheet', type: 'surface-extrude', suppressed: false, operation: 'new', profileFeatureId: 's', contourIds: ['line'],
    distanceMillimeters: 4, directionVector: [0, .6, .8], startingOffsetMillimeters: 2, secondEnd: { endType: 'blind', distanceMillimeters: 3 } },
] };
function run(entry, document) {
  const result = spawnSync(process.execPath, [entry], { input: JSON.stringify({ phase: 'build', content: JSON.stringify(document) }), encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
try {
  execFileSync(process.env.AETHER_BUILD_PYTHON || 'python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, temporary]);
  const prior = join(temporary, 'aether_cad_service/runtime/runner.mjs');
  const oldDocument = structuredClone(document); oldDocument.formatVersion = 22;
  for (const key of ['directionVector', 'startingOffsetMillimeters', 'secondEnd']) delete oldDocument.features[1][key];
  assert.equal(run(prior, oldDocument).status, 'ok', 'The previous reader must genuinely build a legacy sheet');
  const refused = run(prior, document);
  assert.notEqual(refused.status, 'ok');
  assert.match(JSON.stringify(refused), /Unsupported Part format version.*23/);
  const rebuilt = run(current, document);
  assert.equal(rebuilt.status, 'ok', JSON.stringify(rebuilt));
  assert.equal(rebuilt.bodies.length, 1);
  rebuilt.bodies[0].bbox_mm.flat().forEach((value, i) => assert.ok(Math.abs(value - [-5, -.6, -.8, 5, 3.6, 4.8][i]) < 1e-5));
  console.log('PASS previous Part22 reader builds legacy Surface, refuses Part23; current worker retains both ends and oblique offset');
} finally { rmSync(temporary, { recursive: true, force: true }); }
