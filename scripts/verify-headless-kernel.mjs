/** Fresh processes exercise the shipped runner, including lazy kernel loading
 * and the stdout JSON protocol. Run after build:automation. */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.mjs', import.meta.url));
const fixtures = JSON.parse(readFileSync(new URL('../aether-engine/src/kernel/oracle/fixtures.json', import.meta.url)));
const references = JSON.parse(readFileSync(new URL('../aether-engine/src/kernel/oracle/freecad-references.json', import.meta.url)));
const close = (actual, expected, label, tolerance = Math.max(1, Math.abs(expected)) * 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
function run(document, phase = 'build', options, entry = runner) {
  const process = spawnSync(globalThis.process.execPath, ['--max-old-space-size=512', entry], {
    input: JSON.stringify({ phase, content: JSON.stringify(document), options }),
    encoding: 'utf8', timeout: 25000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(process.status, 0, process.stderr || String(process.error));
  // Parsing the entire stream catches native STEP diagnostics leaking to stdout.
  const result = JSON.parse(process.stdout);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  return result;
}
for (const name of ['plate', 'transform-scale-xyz', 'extrude-up-to-cone']) {
  const document = fixtures.find(f => f.name === name);
  const built = run(document);
  assert.equal(built.bodies.length, references[name].length);
  for (const reference of references[name]) {
    const body = built.bodies.find(b => b.id === reference.id);
    assert.ok(body, reference.id);
    close(body.volume_mm3, reference.volume_mm3, `${name} volume`);
    // The old cone oracle bounds came from a tessellation. Its analytic radius
    // is 20 mm, from z=30 to z=60; compare exact geometry with those bounds.
    const bounds = name === 'extrude-up-to-cone' && reference.id.endsWith(':body-cone') ? [[-20,-20,30],[20,20,60]] : reference.bbox;
    body.bbox_mm.flat().forEach((value, i) => close(value, bounds.flat()[i], `${name} bounds ${i}`, 1e-6));
  }
  console.log(`PASS ${name}: exact build and bounds`);
}

// Delete-face discovers its missing kernel capability only during evaluation;
// it cannot rely on the up-front feature scan used for scaling and cone stops.
const plate = fixtures.find(f => f.name === 'plate');
const body = run(plate).bodies[0];
const edge = body.topology.flatMap(f => f.candidates).find(c => c.kind === 'edge-midpoint' && c.edgeAnchor && Math.abs(c.origin[2] - 12) < 1e-6 && Math.abs(c.measurements?.linearDirection?.[0] ?? 0) > .5);
assert.ok(edge, 'top straight edge');
const healed = { ...plate, features: [...plate.features,
  { id: 'f', type: 'fillet', name: 'Fillet', suppressed: false, radiusMillimeters: 2, edges: [{ kind: 'solid-edge', sourceFeatureId: 'e', bodyId: body.id, anchor: edge.edgeAnchor, label: 'Edge' }] },
  { id: 'df', type: 'delete-face', name: 'Delete fillet', suppressed: false, targetBodyId: body.id, faces: [{ sourceFeatureId: 'f', bodyId: body.id, label: 'Round', surfaceType: 'cylinder' }] },
] };
const built = run(healed);
assert.equal(built.bodies.length, 1);
close(built.bodies[0].volume_mm3, 48000, 'healed build');
assert.equal(built.bodies[0].face_count, 6);
const analysis = run(healed, 'analyze', { kind: 'properties' });
assert.equal(analysis.measurements.length, 1);
close(analysis.measurements[0].volume_mm3, 48000, 'healed analysis');
const exported = run(healed, 'export', { format: 'step' });
const step = Buffer.from(exported.data_base64, 'base64').toString('utf8');
assert.match(step, /^ISO-10303-21;/);
assert.match(step, /END-ISO-10303-21;/);
console.log('PASS lazy capability retry: build, analysis and STEP export in separate processes');

const extracted = mkdtempSync(join(tmpdir(), 'aether-runner-'));
try {
  const archive = fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.pyz', import.meta.url));
  execFileSync(process.env.AETHER_BUILD_PYTHON || 'python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, extracted]);
  const packaged = run(healed, 'build', undefined, join(extracted, 'aether_cad_service/runtime/runner.mjs'));
  close(packaged.bodies[0].volume_mm3, 48000, 'packaged lazy kernel');
  console.log('PASS installed zipapp contains both kernels and can rebuild without checkout dependencies');
} finally { rmSync(extracted, { recursive: true, force: true }); }
