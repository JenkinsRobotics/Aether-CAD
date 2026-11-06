import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { measureVolume } from 'replicad';
import { parsePartDocument, type PartFeature } from '../document';
import { initNodeKernel } from './node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from './part-evaluator';

beforeAll(async () => { await initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url))); }, 30000);
afterAll(resetEvaluationCache);
const bracket = () => parsePartDocument(JSON.stringify({format:'aether-part',formatVersion:22,documentId:'bracket-edge',name:'Bracket',units:'millimeter',features:[
  {id:'s',name:'L profile',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[40,0],[40,-6],[6,-6],[6,-30],[0,-30]]}},
  {id:'e',name:'Extrude',type:'extrude',profileFeatureId:'s',distanceMillimeters:60,operation:'new',bodyId:'body',suppressed:false},
]}));
function selectedBracket() {
  const doc=bracket();
  const model=evaluatePartDocument(doc);
  const edge=model.parts[0].topology.flatMap(face=>face.candidates).find(c=>c.edgeAnchor && Math.hypot(c.origin[0]-40,c.origin[1]+30,c.origin[2]+6)<1e-6)!;
  expect(edge).toBeDefined();
  const finish:Extract<PartFeature,{type:'fillet'}>={id:'f',name:'Outer fillet',type:'fillet',radiusMillimeters:2,targetBodyId:'body',suppressed:false,
    edges:[{kind:'solid-edge',sourceFeatureId:'e',bodyId:'body',anchor:edge.edgeAnchor!,label:'Outer edge'}]};
  doc.features.push(finish);return doc;
}
it.each(['length','plane'] as const)('keeps a native straight-edge fillet through an upstream %s edit',kind=>{
  const doc=selectedBracket();
  if(kind==='length' && doc.features[1].type==='extrude')doc.features[1].distanceMillimeters=59.4;
  if(kind==='plane' && doc.features[0].type==='profile')doc.features[0].offsetMillimeters=.01;
  let volume=0;
  evaluatePartDocument(doc,{withBodies:bodies=>{volume=measureVolume([...bodies.values()][0]);}});
  expect(volume).toBeCloseTo((384-(4-Math.PI))*(kind==='length'?59.4:60),4);
});
it('refuses a moved supporting line when endpoint identity remains ambiguous',()=>{
  const doc=selectedBracket();
  const profile=doc.features[0];
  if(profile.type!=='profile'||profile.profile.type!=='polygon')throw Error('Fixture profile');
  profile.profile.pointsMillimeters[1][0]=39.6;profile.profile.pointsMillimeters[2][0]=39.6;
  expect(()=>evaluatePartDocument(doc)).toThrow(/changed or is ambiguous/);
});
