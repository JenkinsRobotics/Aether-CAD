/** Prior readers must refuse connected Surface Add before interpreting identity. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.ok(process.argv[2], 'Provide the released Part25 worker manifest');
const manifestPath = resolve(process.argv[2]), manifest = JSON.parse(readFileSync(manifestPath));
const archive = resolve(dirname(manifestPath), manifest.entry);
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), manifest.sha256);
const temp = mkdtempSync(join(tmpdir(), 'aether-surface-add-format-'));
const current = fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.mjs', import.meta.url));
const sketch = (id, xs, z=0) => ({ id, type:'profile',name:id,suppressed:false,plane:'XY',offsetMillimeters:z,
 profile:{type:'drawing',contours:xs.map((x,i)=>({id:`line-${i}`,type:'path',start:[x,0],segments:[{type:'line',end:[x+10,0]}]}))}});
const sheet = (id, source) => ({id,type:'surface-extrude',name:id,suppressed:false,operation:'new',bodyId:id,profileFeatureId:source,distanceMillimeters:4});
const old = {format:'aether-part',formatVersion:25,documentId:'groups',name:'Groups',units:'millimeter',features:[
 sketch('s1',[0]),sheet('a','s1'),sketch('s2',[20]),sheet('b','s2'),sketch('extension',[0,20],4),
 {...sheet('join','extension'),operation:'add',targetBodyId:'b',targetBodyIds:['b','a']} ]};
function run(entry, document) {
 const result=spawnSync(process.execPath,[entry],{input:JSON.stringify({phase:'build',content:JSON.stringify(document)}),encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024});
 assert.equal(result.status,0,result.stderr||String(result.error));return JSON.parse(result.stdout);
}
try {
 execFileSync(process.env.AETHER_BUILD_PYTHON||'python3',['-c','import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,temp]);
 const prior=join(temp,'aether_cad_service/runtime/runner.mjs');
 const before=run(prior,old),after=run(current,old);
 assert.equal(before.status,'ok',JSON.stringify(before));assert.equal(after.status,'ok',JSON.stringify(after));
 assert.deepEqual(after.bodies.map(b=>[b.id,b.bbox_mm]),before.bodies.map(b=>[b.id,b.bbox_mm]));assert.equal(after.bodies.length,1);
 const next=structuredClone(old);next.formatVersion=26;next.features.at(-1).connectedMerge=true;
 const separate=run(current,next);assert.equal(separate.status,'ok',JSON.stringify(separate));assert.deepEqual(separate.bodies.map(b=>b.id).sort(),['a','b']);
 const refused=run(prior,next);assert.notEqual(refused.status,'ok');assert.match(JSON.stringify(refused),/Unsupported Part format version.*26/);
 console.log('PASS legacy Surface Add compound and identity preserved; Part26 keeps disconnected targets; released Part25 worker refuses new intent');
} finally {rmSync(temp,{recursive:true,force:true});}
