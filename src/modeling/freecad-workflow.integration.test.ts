import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyPartDocument, insertFeature, parsePartDocument, serializePartDocument, availableBodies, setFeatureSuppressed, type PartDocument } from "@aether/core/document";
import { translateDocument } from "../freecad-translate";

const root = fileURLToPath(new URL("../../", import.meta.url));
const engineRoot = process.env.AETHER_CAD_ENGINE_ROOT ?? `${root}freecad-engine`;
const run = (documents: PartDocument[]) => {
  const jobs = documents.map(document => {
    const translation = translateDocument(parsePartDocument(serializePartDocument(document)));
    expect(translation.untranslated).toEqual([]);
    return { protocol: 1, features: translation.features, rollback: null };
  });
  const result = spawnSync(process.env.AETHER_PYTHON ?? "python3", ["-c", `
import sys,json
sys.path.insert(0,sys.argv[1])
from aether_freecad import FreeCADEngine
from aether_freecad.protocol import job_from_json
with FreeCADEngine() as engine:
 results=[]
 for job in json.load(sys.stdin):
  result=engine.build(job_from_json(job))
  results.append({'status':result.status,'diagnostics':result.diagnostics,'scopeResolutions':result.scope_resolutions,'bodyOutputs':result.body_outputs,'bodies':[{'id':body.id,'volume':body.volume_mm3} for body in result.bodies]})
 print(json.dumps(results))
`, engineRoot], { input: JSON.stringify(jobs), encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return JSON.parse(result.stdout) as { status: string; diagnostics: {severity: string}[]; scopeResolutions: Record<string,import('@aether/core/document').ExtrusionScopeResolution>; bodyOutputs:Record<string,string[]>; bodies: {id: string; volume: number}[] }[];
};

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('recomputes automatic scope after depth edits and permits a consumed body to return for downstream operations',async()=>{
 const {resolveExtrusionScopes}=await import('./extrusion-scope-resolution');
 const doc=createEmptyPartDocument('Automatic scope native history');
 for(const [id,z] of [['a',0],['b',20],['other',40]] as const)doc.features.push(
  {id:id+'-s',type:'profile',name:id+' profile',plane:'XY',offsetMillimeters:z,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[-5,-5],[5,-5],[5,5],[-5,5]]}},
  {id,type:'extrude',name:id,profileFeatureId:id+'-s',operation:'new',bodyId:id,distanceMillimeters:5,suppressed:false});
 doc.features.push({id:'s',type:'profile',name:'Bridge profile',plane:'XY',offsetMillimeters:5,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
  {id:'e',type:'extrude',name:'Bridge',profileFeatureId:'s',operation:'add',distanceMillimeters:15,scopeMode:'all',scopeResolution:{targets:['a','b'],groups:[{bodyId:'a',sources:['a','b']}]},suppressed:false});
 const shorter=structuredClone(doc);(shorter.features.at(-1) as {distanceMillimeters:number}).distanceMillimeters=10;
 const suppressed=setFeatureSuppressed(doc,'b',true);
 const downstream=(input:PartDocument)=>({...input,features:[...input.features,{id:'cut',type:'extrude' as const,name:'Later cut',profileFeatureId:'s',operation:'cut' as const,targetBodyId:'b',distanceMillimeters:1,endType:'through-all' as const,reversed:true,suppressed:false}]});
 const inputs=[doc,shorter,suppressed,setFeatureSuppressed(doc,'e',true),downstream(shorter),downstream(doc),downstream(shorter)];
 const results=run(inputs);
 for(const i of [0,1,2,3,4,6]){
  expect(results[i].diagnostics).toEqual([]);
  expect(availableBodies(resolveExtrusionScopes(inputs[i],results[i].scopeResolutions)).map(b=>b.id)).toEqual(results[i].bodies.map(b=>b.id));
 }
 expect(results[0].bodies.map(b=>b.id)).toEqual(['a','other']);expect(results[0].bodies[0].volume).toBeCloseTo(1000+60*Math.PI,6);
 expect(results[1].bodies.map(b=>b.id)).toEqual(['a','b','other']);expect(results[1].bodies[0].volume).toBeCloseTo(500+40*Math.PI,6);
 expect(results[2].bodies.map(b=>b.id)).toEqual(['a','other']);expect(results[2].bodies[0].volume).toBeCloseTo(500+60*Math.PI,6);
 expect(results[3].bodies.map(b=>b.id)).toEqual(['a','b','other']);
 expect(results[4].bodies[1].volume).toBeCloseTo(500-20*Math.PI,6);
 expect(results[5].diagnostics.some(d=>d.severity==='error')).toBe(true);
 expect(results[6]).toEqual(results[4]);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('repairs and reopens an anchored constrained sketch, rebuilds its cut and preserves history identities',()=>{
 let doc=createEmptyPartDocument('Sketch support repair');
 const rectangle=(id:string,width:number,z:number)=>({id,type:'profile' as const,name:id,suppressed:false,plane:'XY' as const,offsetMillimeters:z,profile:{type:'polygon' as const,pointsMillimeters:[[0,0],[width,0],[width,20],[0,20]] as [number,number][]}});
 doc=insertFeature(doc,rectangle('base-sketch',10,0));
 doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',suppressed:false,profileFeatureId:'base-sketch',operation:'new',bodyId:'body',distanceMillimeters:10});
 doc=insertFeature(doc,rectangle('upper-sketch',5,10));
 doc=insertFeature(doc,{id:'upper',type:'extrude',name:'Upper',suppressed:false,profileFeatureId:'upper-sketch',operation:'add',targetBodyId:'body',distanceMillimeters:5});
 doc=insertFeature(doc,{id:'bore-sketch',type:'profile',name:'Bore sketch',suppressed:false,plane:'XY',offsetMillimeters:0,
  frame:{originMillimeters:[7.5,10,10],normal:[0,0,1],xDirection:[1,0,0]},
  support:{sourceFeatureId:'upper',bodyId:'body',normal:[0,0,1],xDirection:[1,0,0],label:'Ledge',faceAnchor:{centerMillimeters:[7.5,10,10],areaSquareMillimeters:100}},
  profile:{type:'drawing',contours:[{id:'bore',type:'circle',center:[0,0],radius:1}],constraints:[{id:'size',kind:'radius',a:{kind:'circle',contour:0},value:1}]}});
 doc=insertFeature(doc,{id:'cut',type:'extrude',name:'Cut',suppressed:false,profileFeatureId:'bore-sketch',profileContourId:'bore',operation:'cut',targetBodyId:'body',distanceMillimeters:1,endType:'through-all'});
 const changed=structuredClone(doc);(changed.features[1] as {distanceMillimeters:number}).distanceMillimeters=12;
 const repaired=structuredClone(changed),profile=repaired.features[4];
 if(profile.type!=='profile'||!profile.support?.faceAnchor)throw Error('Fixture requires support');
 profile.support.faceAnchor.centerMillimeters=[7.5,10,12];profile.frame!.originMillimeters=[7.5,10,12];
 const moved=structuredClone(repaired),movedProfile=moved.features[4];
 if(movedProfile.type!=='profile'||!movedProfile.support?.faceAnchor)throw Error('Fixture requires support');
 movedProfile.support.faceAnchor.centerMillimeters=[2.5,10,15];movedProfile.frame!.originMillimeters=[2.5,10,15];
 const suppressed=setFeatureSuppressed(repaired,'bore-sketch',true);
 const restored=setFeatureSuppressed(suppressed,'cut',false);
 const results=run([doc,changed,repaired,moved,suppressed,restored,doc]);
 expect(results[1].diagnostics).not.toEqual([]);
 expect(results[1].bodies[0].volume).toBeCloseTo(2700,7);
 for(const index of [0,2,3,4,5,6]){expect(results[index].diagnostics).toEqual([]);expect(results[index].bodies.map(b=>b.id)).toEqual(['body']);}
 expect(results[0].bodies[0].volume).toBeCloseTo(2500-10*Math.PI,7);
 expect(results[2].bodies[0].volume).toBeCloseTo(2700-12*Math.PI,7);
 expect(results[3].bodies[0].volume).toBeCloseTo(2700-15*Math.PI,7);
 expect(results[4].bodies[0].volume).toBeCloseTo(2700,7);
 expect(results[5].bodies[0].volume).toBeCloseTo(results[2].bodies[0].volume,7);
 expect(results[6]).toEqual(results[0]);
 expect(profile.profile).toEqual((doc.features[4] as typeof profile).profile);
 expect(repaired.features.map(f=>f.id)).toEqual(doc.features.map(f=>f.id));
});

// Opt-in native acceptance. Uses the translator and native serializer, not
// hand-written FreeCAD payloads: run AETHER_FREECAD_INTEGRATION=1 npm test --
// src/modeling/freecad-workflow.integration.test.ts from Aether CAD.
describe.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== "1")("real CAD modeling workflow", () => {
  it("selects separate contours, creates two bodies, cuts, edits and reopens with stable IDs", () => {
    let doc = createEmptyPartDocument("Working bracket");
    doc = insertFeature(doc, {id:"s", type:"profile", name:"Sketch", suppressed:false, plane:"XY", offsetMillimeters:0,
      profile:{type:"drawing",contours:[{type:"circle",id:"outer",center:[0,0],radius:10},{type:"circle",id:"other",center:[30,0],radius:3},{type:"circle",id:"hole",center:[0,0],radius:2}]}});
    doc = insertFeature(doc, {id:"e",type:"extrude",name:"Main",suppressed:false,profileFeatureId:"s",profileContourId:"outer",distanceMillimeters:10,operation:"new"});
    doc = insertFeature(doc, {id:"e2",type:"extrude",name:"Other",suppressed:false,profileFeatureId:"s",profileContourId:"other",distanceMillimeters:5,operation:"new"});
    doc = insertFeature(doc, {id:"cut",type:"extrude",name:"Bore",suppressed:false,profileFeatureId:"s",profileContourId:"hole",distanceMillimeters:10,operation:"cut",reversed:true,targetBodyId:availableBodies(doc)[0].id});
    const edited = structuredClone(doc);
    (edited.features[1] as {distanceMillimeters:number}).distanceMillimeters = 15;
    (edited.features[3] as {distanceMillimeters:number}).distanceMillimeters = 15;
    const results = run([doc, edited, {...doc, rollbackIndex:2}]);
    for (const result of results) { expect(result.status).toBe("ok"); expect(result.diagnostics.filter(d=>d.severity==="error")).toEqual([]); }
    expect(results[0].bodies.map(b=>b.id)).toEqual(availableBodies(doc).map(b=>b.id));
    expect(results[0].bodies[0].volume).toBeCloseTo(Math.PI*96*10,5);
    expect(results[1].bodies[0].volume).toBeCloseTo(Math.PI*96*15,5);
    expect(results[1].bodies[1].volume).toBeCloseTo(Math.PI*9*5,5);
    expect(results[2].bodies).toHaveLength(1);
    expect(results[2].bodies[0].volume).toBeCloseTo(Math.PI*100*10,5);
  });
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== "1")("rebuilds the actual earlier solid while editing a sketch, then restores downstream cuts", async () => {
  const { EditHistory, featurePreviewDocument } = await import("./edit-history");
  let doc = createEmptyPartDocument("History rollback");
  doc = insertFeature(doc, {id:"base-sketch",type:"profile",name:"Sketch 1",plane:"XY",offsetMillimeters:0,suppressed:false,profile:{type:"circle",radiusMillimeters:10,centerMillimeters:[0,0]}});
  doc = insertFeature(doc, {id:"base",type:"extrude",name:"Extrude 1",profileFeatureId:"base-sketch",distanceMillimeters:10,operation:"new",suppressed:false});
  doc = insertFeature(doc, {id:"hole-sketch",type:"profile",name:"Sketch 2",plane:"XY",offsetMillimeters:0,suppressed:false,profile:{type:"circle",radiusMillimeters:2,centerMillimeters:[0,0]}});
  doc = insertFeature(doc, {id:"hole",type:"extrude",name:"Remove",profileFeatureId:"hole-sketch",distanceMillimeters:1,endType:"through-all",operation:"cut",reversed:true,suppressed:false});
  const inputs: PartDocument[] = [];
  const history = new EditHistory({evaluate: async document => {inputs.push(document);return {parts:[],sourceName:"Past",parseMilliseconds:0};},show(){},changed(){},error(message){throw Error(message);}});
  const endFirst = history.begin(doc,"base-sketch"); endFirst();
  const endSecond = history.begin(doc,"hole-sketch"); endSecond();
  const changed = structuredClone(doc);
  (changed.features[1] as {distanceMillimeters:number}).distanceMillimeters=20;
  const results=run([...inputs,featurePreviewDocument(changed,"base"),changed,doc]);
  for(const result of results) expect(result.diagnostics).toEqual([]);
  expect(results[0].bodies).toHaveLength(0);
  expect(results[1].bodies[0].volume).toBeCloseTo(Math.PI*100*10,5);
  expect(results[2].bodies[0].volume).toBeCloseTo(Math.PI*100*20,5);
  expect(results[3].bodies[0].volume).toBeCloseTo(Math.PI*96*20,5);
  expect(results[4].bodies[0].volume).toBeCloseTo(Math.PI*96*10,5);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('creates a native Hole, reopens and edits it without changing a second body', () => {
  let doc = createEmptyPartDocument('Hole acceptance');
  doc = insertFeature(doc, {id:'s',type:'profile',name:'Base',suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'circle',radiusMillimeters:10,centerMillimeters:[0,0]}});
  doc = insertFeature(doc, {id:'pad',type:'extrude',name:'Plate',suppressed:false,profileFeatureId:'s',distanceMillimeters:10,operation:'new',bodyId:'plate'});
  doc = insertFeature(doc, {id:'other-sketch',type:'profile',name:'Other',suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'circle',radiusMillimeters:3,centerMillimeters:[30,0]}});
  doc = insertFeature(doc, {id:'other-pad',type:'extrude',name:'Other body',suppressed:false,profileFeatureId:'other-sketch',distanceMillimeters:5,operation:'new',bodyId:'other'});
  doc = insertFeature(doc, {id:'center',type:'profile',name:'Center',suppressed:false,plane:'XY',offsetMillimeters:10,profile:{type:'drawing',contours:[{id:'center-circle',type:'circle',center:[0,0],radius:1}]}});
  doc = insertFeature(doc, {id:'hole',type:'hole',name:'Hole',suppressed:false,profileFeatureId:'center',profileContourId:'center-circle',targetBodyId:'plate',diameterMillimeters:6,depthMillimeters:5,depthType:'blind',cutType:'plain'});
  const changed = structuredClone(doc);
  const hole = changed.features.at(-1) as import('@aether/core/document').HoleFeature;
  hole.diameterMillimeters = 8; hole.depthType = 'through-all';
  const results = run([doc, changed, {...doc,rollbackIndex:5}]);
  for (const result of results) {
    expect(result.diagnostics).toEqual([]);
    expect(result.bodies.find(b=>b.id==='other')!.volume).toBeCloseTo(Math.PI*9*5,5);
  }
  expect(results[0].bodies.find(b=>b.id==='plate')!.volume).toBeCloseTo(Math.PI*(100*10-9*5),5);
  expect(results[1].bodies.find(b=>b.id==='plate')!.volume).toBeCloseTo(Math.PI*84*10,5);
  expect(results[2].bodies.find(b=>b.id==='plate')!.volume).toBeCloseTo(Math.PI*100*10,5);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('persists ordered Loft sections through the translator, then rebuilds a changed profile',()=>{
  let doc=createEmptyPartDocument('Loft acceptance');
  for(const [id,z,radius] of [['base',0,4],['top',10,2]] as const)
    doc=insertFeature(doc,{id,type:'profile',name:id,suppressed:false,plane:'XY',offsetMillimeters:z,profile:{type:'drawing',contours:[{id:`${id}-circle`,type:'circle',center:[0,0],radius}]}});
  doc=insertFeature(doc,{id:'loft',type:'loft',name:'Transition',suppressed:false,operation:'new',ruled:false,sections:[{profileFeatureId:'base',profileContourId:'base-circle'},{profileFeatureId:'top',profileContourId:'top-circle'}]});
  const changed=structuredClone(doc);
  ((changed.features[1] as any).profile.contours[0]).radius=3;
  const reversed=structuredClone(changed);
  (reversed.features[2] as import('@aether/core/document').LoftFeature).sections.reverse();
  const results=run([doc,changed,reversed]);
  for(const result of results) {expect(result.diagnostics).toEqual([]);expect(result.bodies[0].id).toBe(availableBodies(doc)[0].id);}
  expect(results[0].bodies[0].volume).toBeCloseTo(Math.PI*10*28/3,4);
  expect(results[1].bodies[0].volume).toBeCloseTo(Math.PI*10*37/3,4);
  expect(results[2].bodies[0].volume).toBeCloseTo(results[1].bodies[0].volume,4);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('persists a geometric Draft reference and rebuilds angle/direction edits',async()=>{
  const {createRectanglePartDocument}=await import('@aether/core/document');
  let doc=createRectanglePartDocument('Draft acceptance',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
  doc=insertFeature(doc,{id:'draft',type:'draft',name:'Draft',suppressed:false,facePlane:{plane:'XZ',offsetMillimeters:10},neutralPlane:{plane:'XY',offsetMillimeters:0},angleDegrees:5,reversed:false,targetBodyId:availableBodies(doc)[0].id});
  const changed=structuredClone(doc);
  const draft=changed.features.at(-1) as import('@aether/core/document').DraftFeature;
  draft.angleDegrees=8;draft.reversed=true;
  const results=run([doc,changed]);
  for(const result of results)expect(result.diagnostics).toEqual([]);
  expect(results[0].bodies[0].volume).toBeCloseTo(4000-1000*Math.tan(5*Math.PI/180),4);
  expect(results[1].bodies[0].volume).toBeCloseTo(4000+1000*Math.tan(8*Math.PI/180),4);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('rebuilds saved polar-pattern count edits through the native translator',()=>{
  let doc=createEmptyPartDocument('Bolt circle');
  doc=insertFeature(doc,{id:'base',type:'profile',name:'Base',suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'circle',radiusMillimeters:10,centerMillimeters:[0,0]}});
  doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Plate',suppressed:false,profileFeatureId:'base',distanceMillimeters:10,operation:'new',bodyId:'plate'});
  doc=insertFeature(doc,{id:'center',type:'profile',name:'Center',suppressed:false,plane:'XY',offsetMillimeters:10,profile:{type:'circle',radiusMillimeters:1,centerMillimeters:[5,0]}});
  doc=insertFeature(doc,{id:'hole',type:'hole',name:'Pilot hole',suppressed:false,profileFeatureId:'center',diameterMillimeters:2,depthMillimeters:10,depthType:'through-all',cutType:'plain',targetBodyId:'plate'});
  doc=insertFeature(doc,{id:'pattern',type:'pattern',name:'Bolt circle',suppressed:false,sourceFeatureId:'hole',targetBodyId:'plate',patternType:'polar',axis:'Z',count:4,angleDegrees:360,reversed:false});
  const changed=structuredClone(doc);
  (changed.features.at(-1) as import('@aether/core/document').PatternFeature).count=6;
  const results=run([doc,changed]);
  for(const result of results)expect(result.diagnostics).toEqual([]);
  expect(results[0].bodies[0].volume).toBeCloseTo(Math.PI*960,4);
  expect(results[1].bodies[0].volume).toBeCloseTo(Math.PI*940,4);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('rebuilds Boolean operation, keep-tools and upstream profile edits with stable output IDs',()=>{
  let doc=createEmptyPartDocument('Boolean acceptance');
  for(const [key,x] of [['target',0],['tool',5]] as const) {
    doc=insertFeature(doc,{id:`${key}-sketch`,type:'profile',name:key,suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'polygon',pointsMillimeters:[[x,0],[x+10,0],[x+10,10],[x,10]]}});
    doc=insertFeature(doc,{id:`${key}-pad`,type:'extrude',name:key,suppressed:false,profileFeatureId:`${key}-sketch`,distanceMillimeters:10,operation:'new',bodyId:key});
  }
  doc=insertFeature(doc,{id:'boolean',type:'boolean',name:'Combine',suppressed:false,operation:'union',targetBodyId:'target',toolBodyIds:['tool'],keepTools:false});
  const cut=structuredClone(doc);
  Object.assign(cut.features.at(-1)!,{operation:'cut',keepTools:true});
  const edited=structuredClone(cut);
  Object.assign(edited.features[3],{distanceMillimeters:5});
  const results=run([doc,cut,edited,{...doc,rollbackIndex:4}]);
  for(const r of results)expect(r.diagnostics).toEqual([]);
  expect(results[0].bodies).toEqual([{id:'target',volume:1500}]);
  expect(results[1].bodies.map(b=>b.id)).toEqual(['target','tool']);
  expect(results[1].bodies[0].volume).toBeCloseTo(500);
  expect(results[2].bodies[0].volume).toBeCloseTo(750);
  expect(results[3].bodies.map(b=>b.id)).toEqual(['target','tool']);
});


it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('intersects a saved extrusion with its target, rebuilds depth edits, and preserves the other body', () => {
  let doc = createEmptyPartDocument('Intersect workflow');
  for (const [id, x] of [['target', 0], ['other', 30]] as const) {
    doc = insertFeature(doc, { id: id + '-sketch', type: 'profile', name: id, plane: 'XY', offsetMillimeters: 0, suppressed: false,
      profile: {type: 'polygon', pointsMillimeters: [[x-5,-5],[x+5,-5],[x+5,5],[x-5,5]]} });
    doc = insertFeature(doc, { id, type: 'extrude', name: id, profileFeatureId: id + '-sketch', distanceMillimeters: 10, operation: 'new', bodyId: id, suppressed: false });
  }
  doc = insertFeature(doc, { id: 'mask', type: 'profile', name: 'Overlap', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: {type: 'polygon', pointsMillimeters: [[0,-5],[8,-5],[8,5],[0,5]]} });
  doc = insertFeature(doc, { id: 'intersect', type: 'extrude', name: 'Intersect', profileFeatureId: 'mask', distanceMillimeters: 6, operation: 'intersect', targetBodyId: 'target', suppressed: false });
  const changed = structuredClone(doc);
  (changed.features.at(-1) as {distanceMillimeters: number}).distanceMillimeters = 8;
  const through = structuredClone(changed);
  (through.features.at(-1) as {endType: string}).endType = 'through-all';
  const suppressed = structuredClone(doc); suppressed.features.at(-1)!.suppressed = true;
  const results = run([doc, changed, through, suppressed]);
  for (const [index, result] of results.entries()) {
    expect(result.status).toBe('ok'); expect(result.diagnostics).toEqual([]);
    expect(result.bodies.map(b => b.id)).toEqual(['target','other']);
    expect(result.bodies[0].volume).toBeCloseTo([300,400,500,1000][index], 5);
    expect(result.bodies[1].volume).toBeCloseTo(1000, 5);
  }
});


it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('rebuilds saved Up-to-next end offsets when the limit moves', () => {
  let doc=createEmptyPartDocument('End offset');
  doc=insertFeature(doc,{id:'limit-sketch',type:'profile',name:'Limit plane',plane:'XY',offsetMillimeters:10,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[20,0],[20,20],[0,20]]}});
  doc=insertFeature(doc,{id:'limit',type:'extrude',name:'Limit',profileFeatureId:'limit-sketch',distanceMillimeters:3,operation:'new',bodyId:'limit',suppressed:false});
  doc=insertFeature(doc,{id:'profile',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[10,10]}});
  doc=insertFeature(doc,{id:'result',type:'extrude',name:'Up to next',profileFeatureId:'profile',distanceMillimeters:1,operation:'new',bodyId:'result',endType:'up-to-next',endOffsetMillimeters:2,suppressed:false});
  const moved=structuredClone(doc);(moved.features[0] as {offsetMillimeters:number}).offsetMillimeters=30;
  const beyond=structuredClone(doc);(beyond.features[3] as {endOffsetMillimeters:number}).endOffsetMillimeters=-2;
  const results=run([doc,moved,beyond]);
  results.forEach((result,i)=>{
    expect(result.diagnostics).toEqual([]);
    expect(result.bodies.find(b=>b.id==='result')!.volume).toBeCloseTo(Math.PI*4*[8,28,12][i],5);
    expect(result.bodies.find(b=>b.id==='limit')!.volume).toBeCloseTo(1200,5);
  });
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('rebuilds saved directional revolves after upstream sketch and angle changes', () => {
  let doc=createEmptyPartDocument('Directional revolve');
  doc=insertFeature(doc,{id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[5,2],[25,2],[25,12],[5,12]]}});
  doc=insertFeature(doc,{id:'r',type:'revolve',name:'Revolve',profileFeatureId:'s',axis:'X',angleDegrees:90,secondAngleDegrees:30,reversed:true,operation:'new',bodyId:'ring',suppressed:false});
  const symmetric=structuredClone(doc);Object.assign(symmetric.features[1],{symmetric:true,secondAngleDegrees:undefined,angleDegrees:120});
  const moved=structuredClone(symmetric);Object.assign(moved.features[0],{profile:{type:'polygon',pointsMillimeters:[[5,2],[45,2],[45,12],[5,12]]}});
  run([doc,symmetric,moved]).forEach((result,i)=>{
    expect(result.diagnostics).toEqual([]);
    expect(result.bodies).toHaveLength(1);expect(result.bodies[0].id).toBe('ring');
    expect(result.bodies[0].volume).toBeCloseTo(2800*Math.PI/3*(i===2?2:1),4);
  });
});

describe.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('native planar face push/pull',()=>{
  const box=()=>{
    let doc=createEmptyPartDocument('Face extrusion');
    doc=insertFeature(doc,{id:'outline',type:'profile',name:'Outline',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[10,0],[10,20],[0,20]]}});
    return insertFeature(doc,{id:'pad',type:'extrude',name:'Base',profileFeatureId:'outline',distanceMillimeters:10,operation:'new',bodyId:'base',suppressed:false});
  };
  const push=(doc:PartDocument,distance:number,normal:[number,number,number]=[0,0,1])=>insertFeature(doc,{id:'push',type:'face-extrude',name:'Push/Pull',sourceFeatureId:'pad',targetBodyId:'base',normal,faceLabel:'Top face',distanceMillimeters:distance,suppressed:false});
  it('adds/cuts exact material, edits upstream, suppresses and reopens with the same body identity',()=>{
    const outward=push(box(),5),inward=push(box(),-3);
    const edited=structuredClone(outward);(edited.features.find(f=>f.id==='pad') as any).distanceMillimeters=20;
    const suppressed=structuredClone(outward);suppressed.features.at(-1)!.suppressed=true;
    const [a,b,c,d]=run([outward,inward,edited,suppressed]);
    for(const result of [a,b,c,d]){expect(result.status).toBe('ok');expect(result.diagnostics.filter(d=>d.severity==='error')).toEqual([]);expect(result.bodies.map(body=>body.id)).toEqual(['base']);}
    expect(a.bodies[0].volume).toBeCloseTo(3000,6);
    expect(b.bodies[0].volume).toBeCloseTo(1400,6);
    expect(c.bodies[0].volume).toBeCloseTo(5000,6);
    expect(d.bodies[0].volume).toBeCloseTo(2000,6);
  });
  it('rejects total removal and faces that do not exist instead of committing invalid geometry',()=>{
    const results=run([push(box(),-20),push(box(),2,[Math.SQRT1_2,Math.SQRT1_2,0])]);
    for(const result of results){expect(result.diagnostics.some(d=>d.severity==='error')).toBe(true);expect(result.bodies[0].volume).toBeCloseTo(2000,6);}
  });
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens a selected Up-to-face reference and follows its upstream height rather than the nearest face',()=>{
  let doc=createEmptyPartDocument('Selected stop');
  for(const [id,z] of [['near',5],['limit',20]] as const){
    doc=insertFeature(doc,{id:id+'-sketch',type:'profile',name:id,plane:'XY',offsetMillimeters:z,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[20,0],[20,20],[0,20]]}});
    doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:id+'-sketch',distanceMillimeters:3,operation:'new',bodyId:id,suppressed:false});
  }
  doc=insertFeature(doc,{id:'profile',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[10,10]}});
  doc=insertFeature(doc,{id:'result',type:'extrude',name:'Up to face',profileFeatureId:'profile',distanceMillimeters:1,operation:'new',bodyId:'result',endType:'up-to-face',endReference:{sourceFeatureId:'limit',bodyId:'limit',normal:[0,0,-1],label:'Bottom'},startingOffsetMillimeters:1,endOffsetMillimeters:2,suppressed:false});
  const moved=structuredClone(doc);(moved.features[2] as {offsetMillimeters:number}).offsetMillimeters=30;
  const results=run([doc,moved]);
  results.forEach((result,i)=>{
    expect(result.diagnostics).toEqual([]);
    expect(result.bodies.find(b=>b.id==='result')!.volume).toBeCloseTo(Math.PI*4*[17,27][i],5);
    expect(result.bodies.filter(b=>b.id!=='result')).toHaveLength(2);
    result.bodies.filter(b=>b.id!=='result').forEach(body=>expect(body.volume).toBeCloseTo(1200,6));
  });
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('saves a tilted stopping plane, rebuilds upstream placement, suppresses and restores the extrusion',()=>{
  const c=1/Math.sqrt(1.25);
  let doc=createEmptyPartDocument('Tilted plane stop');
  doc=insertFeature(doc,{id:'stop-profile',type:'profile',name:'Tilted reference',plane:'XY',offsetMillimeters:0,suppressed:false,
    frame:{originMillimeters:[0,0,20],xDirection:[c,0,c/2],normal:[-c/2,0,c]},profile:{type:'polygon',pointsMillimeters:[[0,0],[2,0],[2,2],[0,2]]}});
  doc=insertFeature(doc,{id:'stop',type:'extrude',name:'Reference plate',profileFeatureId:'stop-profile',distanceMillimeters:1,operation:'new',bodyId:'stop',suppressed:false});
  doc=insertFeature(doc,{id:'profile',type:'profile',name:'Round profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[0,0]}});
  doc=insertFeature(doc,{id:'result',type:'extrude',name:'Tilted extrude',profileFeatureId:'profile',distanceMillimeters:1,operation:'new',bodyId:'result',endType:'up-to-face',endReference:{sourceFeatureId:'stop',bodyId:'stop',normal:[c/2,0,-c],label:'Sloped underside'},suppressed:false});
  const moved=structuredClone(doc);
  (moved.features[0] as import('@aether/core/document').ProfileFeature).frame!.originMillimeters[2]=30;
  const suppressed=structuredClone(doc);suppressed.features.at(-1)!.suppressed=true;
  const results=run([doc,moved,suppressed,doc]);
  results.forEach(result=>expect(result.diagnostics).toEqual([]));
  for(const [i,height] of [[0,20],[1,30],[3,20]]){
    expect(results[i].bodies.map(b=>b.id)).toEqual(['stop','result']);
    expect(results[i].bodies[1].volume).toBeCloseTo(Math.PI*4*height,5);
  }
  expect(results[2].bodies.map(b=>b.id)).toEqual(['stop']);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens a multi-part cut, updates its sketch, suppresses and edits a face of the second target',()=>{
 let doc=createEmptyPartDocument('Scoped cut');
 for(const [id,z] of [['a',0],['b',20],['other',40]] as const){
  doc=insertFeature(doc,{id:id+'-s',type:'profile',name:id,plane:'XY',offsetMillimeters:z,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[10,0],[10,10],[0,10]]}});
  doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:id+'-s',operation:'new',bodyId:id,distanceMillimeters:5,suppressed:false});
 }
 doc=insertFeature(doc,{id:'circle',type:'profile',name:'Hole',plane:'XY',offsetMillimeters:30,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[5,5]}});
 doc=insertFeature(doc,{id:'cut',type:'extrude',name:'Cut selected parts',profileFeatureId:'circle',operation:'cut',targetBodyId:'a',targetBodyIds:['a','b'],endType:'through-all',distanceMillimeters:1,suppressed:false});
 const edited=structuredClone(doc);((edited.features[6] as any).profile).radiusMillimeters=3;
 const suppressed=structuredClone(doc);suppressed.features[7].suppressed=true;
 const pull=insertFeature(doc,{id:'pull',type:'face-extrude',name:'Extend second part',sourceFeatureId:'cut',targetBodyId:'b',normal:[0,0,1],faceLabel:'Top of second target',distanceMillimeters:2,suppressed:false});
 const results=run([doc,edited,suppressed,pull]);
 results.forEach((result,i)=>{
  expect(result.diagnostics).toEqual([]);expect(result.bodies.map(b=>b.id)).toEqual(['a','b','other']);
  expect(result.bodies[2].volume).toBeCloseTo(500,5);
  const area=i===2?100:100-Math.PI*(i===1?9:4);
  expect(result.bodies[0].volume).toBeCloseTo(area*5,5);
  expect(result.bodies[1].volume).toBeCloseTo(area*(i===3?7:5),5);
 });
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens an Add merge, updates its profile, restores consumed parts and continues on the primary',()=>{
 let doc=createEmptyPartDocument('Scoped Add');
 for(const [id,z] of [['a',0],['b',20],['other',40]] as const){
  doc=insertFeature(doc,{id:id+'-s',type:'profile',name:id,plane:'XY',offsetMillimeters:z,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[10,0],[10,10],[0,10]]}});
  doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:id+'-s',operation:'new',bodyId:id,distanceMillimeters:5,suppressed:false});
 }
 doc=insertFeature(doc,{id:'circle',type:'profile',name:'Bridge',plane:'XY',offsetMillimeters:5,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[5,5]}});
 doc=insertFeature(doc,{id:'merge',type:'extrude',name:'Join selected parts',profileFeatureId:'circle',operation:'add',targetBodyId:'a',targetBodyIds:['a','b'],distanceMillimeters:15,suppressed:false});
 const edited=structuredClone(doc);((edited.features[6] as any).profile).radiusMillimeters=3;
 const suppressed=setFeatureSuppressed(doc,'merge',true);
 const pull=insertFeature(doc,{id:'pull',type:'face-extrude',name:'Extend merged part',sourceFeatureId:'merge',targetBodyId:'a',normal:[0,0,1],faceLabel:'Top',distanceMillimeters:2,suppressed:false});
 // Give Push/Pull a unique planar top by extending the bridge to the full plate.
 (pull.features[6] as any).profile={type:'polygon',pointsMillimeters:[[0,0],[10,0],[10,10],[0,10]]};
 const documents=[doc,edited,suppressed,setFeatureSuppressed(suppressed,'merge',false),pull];
 const results=run(documents);
 results.forEach((result,i)=>{
  expect(result.diagnostics).toEqual([]);
  expect(result.bodies.map(b=>b.id)).toEqual(availableBodies(documents[i]).map(b=>b.id));
  expect(result.bodies.at(-1)?.volume).toBeCloseTo(500,5);
  if(i===2)result.bodies.forEach(b=>expect(b.volume).toBeCloseTo(500,5));
  else expect(result.bodies[0].volume).toBeCloseTo(i===4?2700:1000+Math.PI*(i===1?9:4)*15,5);
 });
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens anchored Push/Pull, reports changed references, then rebuilds after explicit repair',()=>{
 let doc=createEmptyPartDocument('Stepped face edit');
 doc=insertFeature(doc,{id:'s',type:'profile',name:'Base sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[10,0],[10,20],[0,20]]}});
 doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'s',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});
 doc=insertFeature(doc,{id:'top',type:'profile',name:'Upper sketch',plane:'XY',offsetMillimeters:10,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[5,0],[5,20],[0,20]]}});
 doc=insertFeature(doc,{id:'step',type:'extrude',name:'Step',profileFeatureId:'top',operation:'add',targetBodyId:'body',distanceMillimeters:5,suppressed:false});
 doc=insertFeature(doc,{id:'pull',type:'face-extrude',name:'Push/Pull',sourceFeatureId:'step',targetBodyId:'body',normal:[0,0,1],faceAnchor:{centerMillimeters:[2.5,10,15],areaSquareMillimeters:100},faceLabel:'Upper top',distanceMillimeters:2,suppressed:false});
 const changed=structuredClone(doc);(changed.features[3] as any).distanceMillimeters=7;
 const repaired=structuredClone(changed);(repaired.features[4] as any).faceAnchor.centerMillimeters=[2.5,10,17];
 const cut=structuredClone(doc);(cut.features[4] as any).distanceMillimeters=-2;
 const results=run([doc,changed,repaired,cut,setFeatureSuppressed(doc,'pull',true)]);
 results.forEach((result,i)=>{
  if(i===1)expect(result.diagnostics).toHaveLength(1);else expect(result.diagnostics).toEqual([]);
  expect(result.bodies.map(b=>b.id)).toEqual(['body']);
  expect(result.bodies[0].volume).toBeCloseTo([2700,2700,2900,2300,2500][i],5);
 });
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens tapered extrusions and rebuilds angle/profile edits without changing identity',()=>{
 let doc=createEmptyPartDocument('Tapered part');
 doc=insertFeature(doc,{id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:10,centerMillimeters:[0,0]}});
 doc=insertFeature(doc,{id:'e',type:'extrude',name:'Taper',profileFeatureId:'s',distanceMillimeters:10,operation:'new',bodyId:'part',draftAngleDegrees:5,suppressed:false});
 const wider=structuredClone(doc);Object.assign(wider.features[1],{draftAngleDegrees:-8});
 const changed=structuredClone(wider);Object.assign((changed.features[0] as any).profile,{radiusMillimeters:12});
 const results=run([doc,wider,changed,setFeatureSuppressed(changed,'e',true),doc]);
 results.forEach(result=>expect(result.diagnostics).toEqual([]));
 for(const [i,r,angle] of [[0,10,5],[1,10,-8],[2,12,-8],[4,10,5]]){
  const t=Math.tan(angle*Math.PI/180),expected=Math.PI*(r*r*10-r*t*100+t*t*1000/3);
  expect(results[i].bodies.map(b=>b.id)).toEqual(['part']);expect(results[i].bodies[0].volume).toBeCloseTo(expected,6);
 }
 expect(results[3].bodies).toEqual([]);expect(results[4]).toEqual(results[0]);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens independent extrusion ends, updates the opposite limit and restores after suppression',()=>{
 let doc=createEmptyPartDocument('Independent ends');
 for(const [id,z] of [['bottom',-23],['top',30]] as const){
  doc=insertFeature(doc,{id:id+'-s',type:'profile',name:id,plane:'XY',offsetMillimeters:z,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[100,0],[100,100],[0,100]]}});
  doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:id+'-s',distanceMillimeters:3,operation:'new',bodyId:id,suppressed:false});
 }
 doc=insertFeature(doc,{id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:10,centerMillimeters:[50,50]}});
 doc=insertFeature(doc,{id:'e',type:'extrude',name:'Between stops',profileFeatureId:'s',distanceMillimeters:1,operation:'new',bodyId:'part',suppressed:false,
  endType:'up-to-face',endReference:{sourceFeatureId:'top',bodyId:'top',normal:[0,0,-1],label:'Top stop'},endOffsetMillimeters:2,
  secondEnd:{endType:'up-to-face',distanceMillimeters:1,endOffsetMillimeters:1,endReference:{sourceFeatureId:'bottom',bodyId:'bottom',normal:[0,0,1],label:'Bottom stop'}}});
 const changed=structuredClone(doc);Object.assign(changed.features[0],{offsetMillimeters:-33});
 const tapered=structuredClone(doc);Object.assign(tapered.features[5],{endType:'blind',endReference:undefined,endOffsetMillimeters:undefined,distanceMillimeters:10,draftAngleDegrees:5,secondEnd:{endType:'blind',distanceMillimeters:5,draftAngleDegrees:-8}});
 const results=run([doc,changed,setFeatureSuppressed(doc,'e',true),tapered,doc]);
 results.forEach(r=>expect(r.diagnostics).toEqual([]));
 expect(results[0].bodies.at(-1)?.volume).toBeCloseTo(Math.PI*100*47,5);
 expect(results[1].bodies.at(-1)?.volume).toBeCloseTo(Math.PI*100*57,5);
 expect(results[2].bodies.map(b=>b.id)).toEqual(['bottom','top']);
 const cone=(h:number,a:number)=>{const t=Math.tan(a*Math.PI/180);return Math.PI*(100*h-10*t*h*h+t*t*h*h*h/3);};
 expect(results[3].bodies.at(-1)?.volume).toBeCloseTo(cone(10,5)+cone(5,-8),5);expect(results[4]).toEqual(results[0]);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens drafted face and next limits, rebuilds a moved stop, and retains drafted Through-all cuts',()=>{
 let doc=createEmptyPartDocument('Drafted stopping limits');
 doc=insertFeature(doc,{id:'stop-s',type:'profile',name:'Stopping plane',plane:'XY',offsetMillimeters:10,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[30,0],[30,30],[0,30]]}});
 doc=insertFeature(doc,{id:'stop',type:'extrude',name:'Stop',profileFeatureId:'stop-s',distanceMillimeters:3,operation:'new',bodyId:'stop',suppressed:false});
 doc=insertFeature(doc,{id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:5,centerMillimeters:[15,15]}});
 doc=insertFeature(doc,{id:'e',type:'extrude',name:'Draft to face',profileFeatureId:'s',distanceMillimeters:1,operation:'new',bodyId:'part',suppressed:false,draftAngleDegrees:5,
  endType:'up-to-face',endReference:{sourceFeatureId:'stop',bodyId:'stop',normal:[0,0,-1],label:'Underside'},endOffsetMillimeters:1});
 const moved=structuredClone(doc);Object.assign(moved.features[0],{offsetMillimeters:15});
 const next=structuredClone(moved);Object.assign(next.features[3],{endType:'up-to-next',endReference:undefined});
 const cut=structuredClone(doc);Object.assign(cut.features[3],{endType:'through-all',endReference:undefined,endOffsetMillimeters:undefined,operation:'cut',bodyId:undefined,targetBodyId:'stop',reversed:true});
 const results=run([doc,moved,next,cut,setFeatureSuppressed(doc,'e',true),doc]);
 results.forEach(result=>expect(result.diagnostics).toEqual([]));
 const cone=(low:number,high:number)=>{const t=Math.tan(5*Math.PI/180);return Math.PI*(25*(high-low)-5*t*(high*high-low*low)+t*t*(high**3-low**3)/3);};
 expect(results[0].bodies.map(b=>b.id)).toEqual(['stop','part']);expect(results[0].bodies[1].volume).toBeCloseTo(cone(0,9),5);
 expect(results[1].bodies[1].volume).toBeCloseTo(cone(0,14),5);expect(results[2]).toEqual(results[1]);
 expect(results[3].bodies.map(b=>b.id)).toEqual(['stop']);expect(results[3].bodies[0].volume).toBeCloseTo(2700-cone(10,13),5);
 expect(results[4].bodies.map(b=>b.id)).toEqual(['stop']);expect(results[5]).toEqual(results[0]);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens oblique directions, updates upstream profiles and changes symmetric Through-all without losing scope',()=>{
 let doc=createEmptyPartDocument('Angled extrusion');
 doc=insertFeature(doc,{id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[10,0],[10,10],[0,10]]}});
 doc=insertFeature(doc,{id:'e',type:'extrude',name:'Angled prism',profileFeatureId:'s',distanceMillimeters:10,directionVector:[.6,0,.8],operation:'new',bodyId:'part',suppressed:false});
 const changed=structuredClone(doc);Object.assign(changed.features[1],{directionVector:[0,0,1]});
 const wider=structuredClone(doc);Object.assign((wider.features[0] as any).profile,{pointsMillimeters:[[0,0],[20,0],[20,10],[0,10]]});
 const results=run([doc,changed,wider,setFeatureSuppressed(doc,'e',true),doc]);results.forEach(r=>expect(r.diagnostics).toEqual([]));
 for(const [i,volume] of [[0,800],[1,1000],[2,1600],[4,800]]){expect(results[i].bodies.map(b=>b.id)).toEqual(['part']);expect(results[i].bodies[0].volume).toBeCloseTo(volume,6);}
 expect(results[3].bodies).toEqual([]);
 let cut=createEmptyPartDocument('Symmetric Through-all');
 for(const [id,z] of [['a',-10],['b',10]] as const){cut=insertFeature(cut,{id:id+'s',type:'profile',name:id,plane:'XY',offsetMillimeters:z,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,0],[20,0],[20,20],[0,20]]}});cut=insertFeature(cut,{id,type:'extrude',name:id,profileFeatureId:id+'s',distanceMillimeters:5,operation:'new',bodyId:id,suppressed:false});}
 cut=insertFeature(cut,{id:'s',type:'profile',name:'Bore',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[10,10],radiusMillimeters:2}});
 cut=insertFeature(cut,{id:'e',type:'extrude',name:'Two-sided cut',profileFeatureId:'s',distanceMillimeters:1,endType:'symmetric-through-all',operation:'cut',targetBodyId:'a',targetBodyIds:['a','b'],suppressed:false});
 const changedCut=structuredClone(cut);Object.assign((changedCut.features[4] as any).profile,{radiusMillimeters:3});
 const cuts=run([cut,changedCut,setFeatureSuppressed(cut,'e',true),cut]);cuts.forEach(r=>expect(r.diagnostics).toEqual([]));
 cuts.forEach((r,i)=>{expect(r.bodies.map(b=>b.id)).toEqual(['a','b']);r.bodies.forEach(b=>expect(b.volume).toBeCloseTo(i===2?2000:2000-Math.PI*(i===1?9:4)*5,5));});
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('follows an identified construction line through edit/reorder/save and opposite extrusion ends',()=>{
 const doc=createEmptyPartDocument('Associative direction');
 doc.features.push({id:'guide',name:'Guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,start:[0,0],segments:[{id:'line',type:'line',end:[3,4]}]}]}},
 {id:'circle',name:'Circle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:10,centerMillimeters:[0,0]}},
 {id:'e',name:'Along line',type:'extrude',profileFeatureId:'circle',operation:'new',bodyId:'solid',distanceMillimeters:10,suppressed:false,directionReference:{kind:'sketch-line',sourceFeatureId:'guide',contourId:'path',segmentId:'line'}});
 const changed=structuredClone(doc),guide=changed.features[0] as any;
 guide.profile.contours[0].segments[0].end=[4,3];
 guide.profile.contours.unshift({id:'other',type:'path',construction:true,start:[20,20],segments:[{id:'other-line',type:'line',end:[25,20]}]});
 const opposite=structuredClone(changed);Object.assign(opposite.features.at(-1)!,{secondEnd:{endType:'blind',distanceMillimeters:2}});
 const results=run([doc,changed,opposite]);
 results.forEach(r=>{expect(r.status).toBe('ok');expect(r.diagnostics).toEqual([]);expect(r.bodies[0].id).toBe('solid');});
 expect(results[0].bodies[0].volume).toBeCloseTo(800*Math.PI,6);
 expect(results[1].bodies[0].volume).toBeCloseTo(600*Math.PI,6);
 expect(results[2].bodies[0].volume).toBeCloseTo(720*Math.PI,6);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens thin open-contour extrusions and rebuilds thickness, sketch and suppression edits',()=>{
 const doc=createEmptyPartDocument('Thin wall');
 doc.features.push({id:'s',name:'Open path',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',start:[0,0],segments:[{id:'line',type:'line',end:[20,0]}]}]}},
 {id:'e',name:'Wall',type:'extrude',profileFeatureId:'s',profileContourId:'path',distanceMillimeters:10,operation:'new',bodyId:'wall',suppressed:false,thin:{thickness1Millimeters:2,thickness2Millimeters:1}});
 const centered=structuredClone(doc);Object.assign((centered.features[1] as any).thin,{midplane:true,midplaneThicknessMillimeters:4});
 const longer=structuredClone(centered);(longer.features[0] as any).profile.contours[0].segments[0].end=[30,0];
 const results=run([doc,centered,longer,setFeatureSuppressed(longer,'e',true),longer]);
 results.forEach(r=>expect(r.diagnostics).toEqual([]));
 for(const [index,volume] of [[0,600],[1,800],[2,1200],[4,1200]]){expect(results[index].bodies[0].volume).toBeCloseTo(volume,6);expect(results[index].bodies[0].id).toBe('wall');}
 expect(results[3].bodies).toEqual([]);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('rebuilds selected-part stopping through upstream movement, save, suppression and repair',()=>{
 const doc=createEmptyPartDocument('Part stop');doc.features.push(
 {id:'limit-s',name:'Stop sketch',type:'profile',plane:'XY',offsetMillimeters:20,suppressed:false,profile:{type:'circle',radiusMillimeters:20,centerMillimeters:[0,0]}},
 {id:'limit',name:'Stop',type:'extrude',profileFeatureId:'limit-s',distanceMillimeters:3,operation:'new',bodyId:'stop',suppressed:false},
 {id:'s',name:'Profile',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[0,0]}},
 {id:'e',name:'To part',type:'extrude',profileFeatureId:'s',distanceMillimeters:1,endType:'up-to-part',endPartId:'stop',endOffsetMillimeters:2,bodyId:'solid',operation:'new',suppressed:false});
 const moved=structuredClone(doc);(moved.features[0] as any).offsetMillimeters=30;
 const missing=structuredClone(moved);(missing.features.at(-1) as any).endPartId='deleted';
 const restored=setFeatureSuppressed(setFeatureSuppressed(moved,'limit',true),'e',false);
 expect(translateDocument(missing).untranslated.at(-1)?.reason).toMatch(/Missing reference/);
 const results=run([doc,moved,setFeatureSuppressed(moved,'limit',true),restored]);
 for(const i of [0,1,2,3])expect(results[i].diagnostics).toEqual([]);
 for(const [i,depth]of[[0,18],[1,28],[3,28]]){expect(results[i].bodies.at(-1)?.id).toBe('solid');expect(results[i].bodies.at(-1)?.volume).toBeCloseTo(4*Math.PI*depth,6);}
 expect(results[2].bodies).toEqual([]);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('follows stable sketch vertices through upstream edit, reorder, suppression and file reopen',()=>{
 const doc=createEmptyPartDocument('Vertex stop');doc.features.push(
 {id:'guide',name:'Guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,startVertexId:'start',start:[50,0],segments:[{id:'edge',endVertexId:'end',type:'line',end:[50,20]}]}]}},
 {id:'s',name:'Circle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'e',name:'Up to vertex',type:'extrude',profileFeatureId:'s',distanceMillimeters:1,operation:'new',bodyId:'solid',suppressed:false,endType:'up-to-vertex',endOffsetMillimeters:2,endPointReference:{kind:'sketch-point',sourceFeatureId:'guide',contourId:'path',point:'vertex',vertexId:'end',label:'Guide endpoint'}});
 const moved=structuredClone(doc),guide=moved.features[0] as any;guide.profile.contours[0].segments[0].end=[55,30];guide.profile.contours.unshift({id:'irrelevant',type:'circle',construction:true,center:[0,0],radius:1});
 const suppressed=setFeatureSuppressed(moved,'guide',true),restored=setFeatureSuppressed(suppressed,'e',false);
 const results=run([doc,moved,suppressed,restored]);results.forEach(r=>expect(r.diagnostics).toEqual([]));
 for(const [i,depth] of [[0,18],[1,28],[3,28]]){expect(results[i].bodies[0].id).toBe('solid');expect(results[i].bodies[0].volume).toBeCloseTo(4*Math.PI*depth,6);}
 expect(results[2].bodies).toEqual([]);
});

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== '1')('reopens referenced starts and follows solid/datum edits without freezing the origin',()=>{
 const doc=createEmptyPartDocument('Referenced start');doc.features.push(
 {id:'s',name:'Base circle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:5}},
 {id:'base',name:'Base',type:'extrude',profileFeatureId:'s',operation:'new',bodyId:'base',distanceMillimeters:10,suppressed:false},
 {id:'stop',name:'Stopping datum',type:'plane',plane:'XY',offsetMillimeters:25,suppressed:false},
 {id:'guide',name:'Stop point',type:'profile',plane:'XY',offsetMillimeters:25,suppressed:false,profile:{type:'drawing',contours:[{id:'point',type:'circle',construction:true,center:[50,0],radius:1}]}},
 {id:'p',name:'Circle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'e',name:'From face',type:'extrude',profileFeatureId:'p',operation:'new',bodyId:'solid',distanceMillimeters:5,suppressed:false,
  startingReference:{kind:'face',sourceFeatureId:'base',bodyId:'base',normal:[0,0,1],label:'Top'},startingOffsetMillimeters:2,
  endType:'up-to-vertex',endPointReference:{kind:'sketch-point',sourceFeatureId:'guide',contourId:'point',point:'center',label:'Stop center'}});
 const moved=structuredClone(doc);Object.assign(moved.features[1],{distanceMillimeters:15});
 const datum=structuredClone(moved);Object.assign(datum.features.at(-1)!,{startingReference:{kind:'plane',sourceFeatureId:'stop',label:'Datum'},endType:'blind',endPointReference:undefined});
 const results=run([doc,moved,datum,setFeatureSuppressed(doc,'base',true),doc]);
 results.forEach(r=>expect(r.diagnostics).toEqual([]));
 for(const [i,depth] of [[0,13],[1,8],[2,5],[4,13]]){expect(results[i].bodies.at(-1)?.id).toBe('solid');expect(results[i].bodies.at(-1)?.volume).toBeCloseTo(4*Math.PI*depth,6);}
 expect(results[3].bodies).toEqual([]);
});
