/** Saved-agent region selection through fresh packaged-runner processes.
 * Run after npm run build:automation. Never contacts the installed Studio. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

const runner=fileURLToPath(new URL('../service/aether_cad_service/runtime/runner.mjs',import.meta.url));
function request(input) {
  const result=spawnSync(process.execPath,[runner],{input:JSON.stringify(input),encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024});
  assert.equal(result.status,0,result.stderr||String(result.error));
  return JSON.parse(result.stdout);
}
const ok=input=>{const answer=request(input);assert.ok(!answer.error,JSON.stringify(answer));return answer;};
const build=content=>{const answer=ok({phase:'build',content});assert.equal(answer.status,'ok',JSON.stringify(answer));return answer;};
const close=(value,expected)=>assert.ok(Math.abs(value-expected)<1e-5,`${value} != ${expected}`);
function step(content,id,tool,args,references={}) {
  const candidate=ok({phase:'program_step',content,step:{id,tool:'aether_cad_'+tool,arguments:args},references});
  const proof=build(candidate.candidate);
  const accepted=ok({phase:'program_accept',content:candidate.candidate,pending:candidate.pending,body_outputs:proof.body_outputs,sketch_frames:proof.sketch_frames,scope_resolutions:proof.scope_resolutions});
  return {...accepted,proof};
}
const fixture=JSON.parse(readFileSync(new URL('../aether-engine/src/kernel/oracle/fixtures.json',import.meta.url))).find(f=>f.name==='plate');
fixture.documentId='saved-agent-regions';fixture.features=[{
  id:'s',type:'profile',name:'Overlapping regions',plane:'XY',offsetMillimeters:0,suppressed:false,
  profile:{type:'drawing',contours:[
    {type:'path',start:[0,-10],segments:[{type:'line',end:[20,-10]},{type:'line',end:[20,10]},{type:'line',end:[0,10]},{type:'line',end:[0,-10]}]},
    {type:'circle',center:[20,0],radius:10},
  ],constraints:[{id:'radius',kind:'radius',a:{kind:'circle',contour:1},value:10}]},
}];
const source=JSON.stringify(fixture);
const inspected=ok({command:'cad.sketch.inspect',content:source,arguments:{feature_id:'s',limit:1}}).result;
assert.equal(inspected.regions.total,3);assert.equal(inspected.regions.next_offset,1);
const rejected=request({phase:'program_step',content:source,step:{id:'bad',tool:'aether_cad_extrude',arguments:{profile_id:'s',depth_mm:5,operation:'new'}},references:{}});
assert.match(rejected.error,/multiple closed regions/);assert.equal(rejected.candidate,undefined);
const pad=step(source,'pad','extrude',{profile_id:'s',profile_point_mm:[15,0],depth_mm:5,operation:'new'});
close(pad.proof.bodies[0].volume_mm3,Math.PI*250);
assert.equal(pad.reference.body_id,pad.proof.bodies[0].id);
const edited=step(pad.content,'resize','sketch_dimension',{feature_id:'s',dimension_id:'radius',value:8});
const reopened=build(edited.content);
close(reopened.bodies[0].volume_mm3,Math.PI*160);
assert.equal(reopened.bodies[0].id,pad.reference.body_id);
const selection=JSON.parse(edited.content).features[1].profileSelections[0];
assert.equal(selection.profileRegion.inside.length,2);
assert.ok(selection.profileRegion.contourIds.every(id=>typeof id==='string'&&id.length));
assert.deepEqual(selection,JSON.parse(pad.content).features[1].profileSelections[0]);
console.log('PASS saved agent: inspect, explicit overlap pick, exact extrusion, dimension edit, reopen and stable region/body identities');

fixture.features=[];
const sketch=step(JSON.stringify(fixture),'placed','sketch_circle',{frame:{origin_mm:[10,20,30],x_direction:[0,1,0],y_direction:[0,0,1]},offset_mm:2,flip:'x',center_x_mm:0,center_y_mm:0,radius_mm:3});
assert.equal(ok({command:'cad.sketch.inspect',content:sketch.content,arguments:{feature_id:sketch.reference.feature_id}}).result.flip,'x');
const placed=step(sketch.content,'solid','extrude',{profile_id:{$ref:'placed.feature_id'},depth_mm:5,operation:'new'},{placed:sketch.reference});
close(placed.proof.bodies[0].volume_mm3,45*Math.PI);
placed.proof.bodies[0].bbox_mm.flat().forEach((v,i)=>close(v,[7,17,27,12,23,33][i]));
console.log('PASS saved agent: explicit rotated/offset/flipped sketch frame and qualified step references');
