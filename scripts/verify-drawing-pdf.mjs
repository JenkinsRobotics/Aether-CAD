/** Real OCCT drawing -> packaged headless PDF; no source imports or installed host. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const runner = fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.mjs', import.meta.url));
const evidence = resolve(process.argv[2] ?? '.verification/drawing-pdf');
mkdirSync(evidence, { recursive: true });
let processes = 0;
function run(request, error) {
  processes++;
  const child = spawnSync(process.execPath, [runner], {
    input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  if (error) { assert.match(result.error, error); assert.equal(result.content, undefined); }
  else assert.equal(result.error, undefined, result.error);
  return result;
}
const source = {
  format: 'aether-part', formatVersion: 21, documentId: 'pdf-source', name: 'Bored sleeve Ω', units: 'millimeter',
  features: [
    { id: 'profile', type: 'profile', name: 'Outer circle', suppressed: false, plane: 'XY', offsetMillimeters: 0, profile: { type: 'circle', centerMillimeters: [0, 0], radiusMillimeters: 7 } },
    { id: 'extrude', type: 'extrude', name: 'Sleeve', suppressed: false, profileFeatureId: 'profile', distanceMillimeters: 24, operation: 'new' },
    { id: 'bore', type: 'profile', name: 'Bore circle', suppressed: false, plane: 'XY', offsetMillimeters: 24, profile: { type: 'circle', centerMillimeters: [0, 0], radiusMillimeters: 3 } },
    { id: 'cut', type: 'extrude', name: 'Bore', suppressed: false, profileFeatureId: 'bore', distanceMillimeters: 24, operation: 'cut' },
  ],
};
const created = run({ phase: 'drawing', operation: 'create', content: JSON.stringify(source) });
const document = JSON.parse(created.content), sheet = document.sheets[0];
document.formatVersion = 2;
sheet.name = 'Manufacturing';
sheet.views = [
  { id: 'front', name: 'Front', orientation: 'front', originMm: [65, 75], scale: 2, hiddenLines: true },
  { id: 'top', name: 'Top', orientation: 'top', originMm: [65, 135], scale: 2, hiddenLines: false },
  { id: 'section', name: 'Section A-A', orientation: 'front', originMm: [195, 75], scale: 2, hiddenLines: false, section: { offsetMm: 0, hatchSpacingMm: 2 } },
];
sheet.annotations = [
  { id: 'height', kind: 'height', viewId: 'front', decimals: 2, positionMm: [90, 75] },
  { id: 'note', kind: 'note', text: 'Bore Ø6.00 mm\nУгол 90° ±0.1 mm', positionMm: [150, 145] },
];
document.sheets.push({ id: 'detail', name: 'Isometric', widthMm: 210, heightMm: 297, projection: 'third_angle', annotations: [], views: [
  { id: 'iso', name: 'Isometric', orientation: 'isometric', originMm: [105, 120], scale: 3, hiddenLines: false },
] });
const content = JSON.stringify(document);
const inspected = run({ phase: 'drawing', operation: 'inspect', content });
assert.equal(inspected.sheets[0].annotations[0].text, '24.00');
assert.ok(inspected.sheets[0].views[0].hidden_curves > 0);
assert.ok(inspected.sheets[0].views[2].hatch_lines > 5);
function exportPDF(name, selection = {}) {
  const result = run({ phase: 'drawing', operation: 'export', content, format: 'pdf', ...selection });
  assert.equal(result.mime_type, 'application/pdf');
  const bytes = Buffer.from(result.data_base64, 'base64');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  writeFileSync(resolve(evidence, name + '.pdf'), bytes);
}
exportPDF('active');
exportPDF('detail', { sheet_id: 'detail' });
exportPDF('all', { all_sheets: true });
for (const [selection, message] of [
  [{ sheet_id: 'missing' }, /does not exist/],
  [{ sheet_id: 'detail', all_sheets: true }, /without sheet_id/],
  [{ all_sheets: 'true' }, /boolean/],
]) run({ phase: 'drawing', operation: 'export', content, format: 'pdf', ...selection }, message);
const invalid = structuredClone(document);
invalid.sheets[0].annotations[1].text = '\u{10FFFF}';
run({ phase: 'drawing', operation: 'export', content: JSON.stringify(invalid), format: 'pdf' }, /font does not contain/);
writeFileSync(resolve(evidence, 'sleeve.drawing.json'), content);
assert.deepEqual(run({ phase: 'drawing', operation: 'inspect', content }).sheets, inspected.sheets);
const results = { status: 'passed', fresh_processes: processes, single_selected_all_sheets: true, invalid_exports_refused: true, drawing_unchanged: true };
writeFileSync(resolve(evidence, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
