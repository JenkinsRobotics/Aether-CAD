import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initNodeKernel, runNodeOperation } from '../../../aether-engine/src/kernel/node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from '../../../aether-engine/src/kernel/part-evaluator';
import { parsePartDocument, serializePartDocument } from '../../../aether-engine/src/document';
import { preparePartEdit } from '../../../src/automation/live-commands';
import { getOC, measureVolume } from 'replicad';
const out = process.argv[2];
const fullHistory = process.env.AETHER_EXAMPLES_FULL_HISTORY === '1';
await initNodeKernel(readFileSync('aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm'));
const results: any[] = [];
const volume = (doc: any) => runNodeOperation(doc, () => { let v = 0; evaluatePartDocument(doc, { withBodies: bodies => { for (const b of bodies.values()) v += measureVolume(b); } }); return v; }, resolve('aether-engine/node_modules/opencascade.js/dist/opencascade.full.wasm'));
for (const example of JSON.parse(readFileSync(out + '/input.json', 'utf8'))) {
 for (const part of example.part_definitions) {
  if (process.argv[3] && part.id !== process.argv[3]) continue;
  resetEvaluationCache();
  const doc = parsePartDocument(JSON.stringify(part.feature_document));
  const result: any = { example: example.id, partId: part.id, part: part.name, scope: fullHistory ? 'complete-history' : 'feature-prefix', features: [], errors: [] };results.push(result);
  try {
   result.volume = await volume(doc); assert.ok(result.volume > 0);
   const reopened = parsePartDocument(serializePartDocument(doc));
   assert.equal(reopened.features.length, doc.features.length);
   for (let i = 0; i < doc.features.length; i++) {
    const f: any = doc.features[i];
    assert.ok(!f.type.startsWith('import'));
    const prefix = { ...doc, features: doc.features.slice(0, i + 1) };delete prefix.rollbackIndex;
    let changes: any, tool = 'aether_cad_feature_update', args: any;
    if (f.type === 'profile') {
     const c = f.profile.constraints?.find((c: any) => ['diameter','radius','length'].includes(c.kind) && c.value > 0 && !c.valueExpression);
     if (c) {tool='aether_cad_sketch_dimension';args={feature_id:f.id,dimension_id:c.id,value:c.value * .99};}
     else changes={offsetMillimeters:(f.offsetMillimeters ?? 0)+.01};
    } else {
     const key = ['distanceMillimeters','depthMillimeters','radiusMillimeters','thicknessMillimeters','diameterMillimeters','angleDegrees','spacingMillimeters'].find(k => typeof f[k] === 'number' && f[k] > 0);
     if (key) changes = { [key]: f[key] * .99 };
     else if (f.type === 'boolean') changes={keepTools:!f.keepTools};
     else if (f.type === 'loft') changes={ruled:!f.ruled};
     else if (f.type === 'sweep') changes={reversedPath:!f.reversedPath};
     else if (f.type === 'mirror') changes={offsetMillimeters:(f.offsetMillimeters ?? 0)+.01};
     else if (f.type === 'split' && f.plane?.kind === 'principal') changes={plane:{...f.plane,offsetMillimeters:f.plane.offsetMillimeters+.01}};
     else changes={name:f.name+' — edit audit'};
    }
    const entry: any = { id:f.id, type:f.type, name:f.name, tool, change:args ?? changes };result.features.push(entry);
    writeFileSync(out + '/progress.json', JSON.stringify({ example: example.id, part: part.name, feature: f.name, index: i, total: doc.features.length }));
    try {
     const edited=preparePartEdit(fullHistory ? doc : prefix,tool,args ?? {feature_id:f.id,changes_json:JSON.stringify(changes)}).document;
     entry.volume=await volume(edited);entry.passed=true;
     assert.equal(parsePartDocument(serializePartDocument(edited)).features[i].id,f.id);
    } catch(e) {entry.passed=false;entry.error=String(e);result.errors.push(entry.error);}
   }
   assert.ok(Math.abs((await volume(doc))-result.volume)<Math.max(1,result.volume)*1e-7);
  } catch(e) {result.errors.push(String(e));}
  result.memory = { ...process.memoryUsage(), wasmBytes: (getOC() as any).HEAPU8.buffer.byteLength };
  writeFileSync(out + (process.argv[3] ? '/part-' + process.argv[3] + '.json' : '/results.json'),JSON.stringify(results,null,2));
  console.log(example.id,part.name,result.features.length,'edits',result.errors.length,'errors');
 }
}
const errors=results.filter(r=>r.errors.length);
console.log('Audited',results.length,'Parts;',errors.length,'with errors');
if(errors.length)process.exitCode=1;
