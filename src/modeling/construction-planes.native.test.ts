import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {constructionPlaneFrame,createEmptyPartDocument,parsePartDocument,serializePartDocument,type PartFeature,type PlaneDefinition} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
it.skipIf(process.env.AETHER_FREECAD_INTEGRATION!=='1')('reopens all four plane methods and builds exact solids on their resolved frames',()=>{
 const definitions:PlaneDefinition[]=[
  {method:'offset',reference:{kind:'principal',plane:'XY'},distanceMillimeters:15},
  {method:'mid',references:[{kind:'principal',plane:'XY'},{kind:'feature',featureId:'base'}]},
  {method:'three-point',points:[[0,0,5],[10,0,5],[0,10,5]].map((p,i)=>({kind:'point',partId:'b',candidateId:`v${i}`,positionMillimeters:p as [number,number,number]})) as Extract<PlaneDefinition,{method:'three-point'}>['points']},
  {method:'angle',reference:{kind:'principal',plane:'XY'},axis:{kind:'axis',partId:'b',candidateId:'e',originMillimeters:[0,0,0],directionMillimeters:[1,0,0]},angleDegrees:90},
 ];
 const jobs=definitions.map(definition=>{
  const doc=createEmptyPartDocument('Construction');
  doc.features.push({id:'base',type:'plane',name:'Base',plane:'XY',offsetMillimeters:40,suppressed:false});
  const datum:PartFeature={id:'datum',type:'plane',name:'Datum',plane:'XY',offsetMillimeters:0,suppressed:false,definition};
  const frame=constructionPlaneFrame(datum,doc.features);doc.features.push(datum);
  doc.features.push({id:'profile',type:'profile',name:'Circle',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:5,centerMillimeters:[0,0]},frame});
  doc.features.push({id:'solid',type:'extrude',name:'Solid',profileFeatureId:'profile',distanceMillimeters:2,operation:'new',suppressed:false});
  return {protocol:1,features:translateDocument(parsePartDocument(serializePartDocument(doc))).features};
 });
 const result=spawnSync('python3',['-c',`import sys,json
sys.path.insert(0,sys.argv[1])
from aether_freecad import FreeCADEngine
from aether_freecad.protocol import job_from_json
with FreeCADEngine() as engine:
 output=[]
 for job in json.load(sys.stdin):
  r=engine.build(job_from_json(job));b=r.bodies[0] if r.bodies else None
  output.append({'status':r.status,'diagnostics':r.diagnostics,'volume':b.volume_mm3 if b else 0,'bounds':[[min(b.vertices[i::3]),max(b.vertices[i::3])] for i in range(3)] if b else []})
 print(json.dumps(output))`,process.env.AETHER_TEST_ENGINE_PATH??`${process.cwd()}/freecad-engine`],{input:JSON.stringify(jobs),encoding:'utf8',timeout:60000});
 if(result.status!==0)throw Error(result.stderr||String(result.error));
 const output=JSON.parse(result.stdout);
 const expected=[[-5,5,-5,5,15,17],[-5,5,-5,5,20,22],[-5,5,-5,5,5,7],[-5,5,-2,0,-5,5]];
 output.forEach((r:{status:string;volume:number;bounds:number[][]},index:number)=>{
  expect(r.status,JSON.stringify(r)).toBe('ok');expect(r.volume).toBeCloseTo(Math.PI*50,6);
  r.bounds.flat().forEach((v,i)=>expect(v).toBeCloseTo(expected[index][i],1));
 });
},65000);
