import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initNodeKernel, runNodeOperation } from '../../../aether-engine/src/kernel/node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from '../../../aether-engine/src/kernel/part-evaluator';
import { parsePartDocument } from '../../../aether-engine/src/document';
import { preparePartEdit } from '../../../src/automation/live-commands';
import { measureVolume } from 'replicad';
const out = process.argv[2], results: any[] = [];
await initNodeKernel(readFileSync('aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm'));
const volume = (doc: any) => runNodeOperation(doc, () => {
  let value = 0;
  evaluatePartDocument(doc, { withBodies: bodies => { for (const body of bodies.values()) value += measureVolume(body); } });
  assert.ok(Number.isFinite(value) && value > 0); return value;
}, resolve('aether-engine/node_modules/opencascade.js/dist/opencascade.full.wasm'));
for (const example of JSON.parse(readFileSync(out + '/input.json', 'utf8'))) for (const part of example.part_definitions) {
  if (process.argv[3] && part.id !== process.argv[3]) continue;
  resetEvaluationCache();
  const doc = parsePartDocument(JSON.stringify(part.feature_document));
  const result: any = { example: example.id, partId: part.id, part: part.name, scope: 'complete-history-driving-dimensions', features: [], errors: [] };
  results.push(result);
  try {
    const initial = await volume(doc);
    for (const feature of doc.features) {
      if (feature.type !== 'profile' || feature.profile.type !== 'drawing') continue;
      for (const dimension of feature.profile.constraints ?? []) {
        if (!['length', 'diameter', 'radius', 'distance', 'horizontal-distance', 'vertical-distance', 'angle'].includes(dimension.kind)
          || typeof dimension.value !== 'number' || dimension.value === 0 || dimension.valueFrom || dimension.valueExpression || dimension.reference) continue;
        const entry: any = { id: feature.id, name: feature.name, dimension: dimension.id, before: dimension.value, requested: dimension.value * .99 };
        result.features.push(entry);
        writeFileSync(out + '/progress.json', JSON.stringify({ example: example.id, part: part.name, feature: feature.name, dimension: dimension.id }));
        try {
          const edited = preparePartEdit(doc, 'aether_cad_sketch_dimension', { feature_id: feature.id, dimension_id: dimension.id, value: entry.requested }).document;
          entry.volume = await volume(edited); entry.passed = true;
        } catch (error) { entry.passed = false; entry.error = String(error); result.errors.push(entry.error); }
        assert.ok(Math.abs((await volume(doc)) - initial) < initial * 1e-7);
      }
    }
  } catch (error) { result.errors.push(String(error)); }
  writeFileSync(out + '/part-' + process.argv[3] + '.json', JSON.stringify(results, null, 2));
  console.log(example.id, part.name, result.features.length, 'dimensions', result.errors.length, 'errors');
}
if (results.some(result => result.errors.length)) process.exitCode = 1;
