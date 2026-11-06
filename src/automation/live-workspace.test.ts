import {expect,it,vi} from 'vitest';
import {createEmptyPartDocument,availableBodies,bodyIDForFeature,type PartDocument} from '@aether/core/document';
import {cadAgentTools,preparePartEdit} from './live-commands';
import {CADAgentEditor,type CADAgentWorkspace} from './live-workspace';
import type {ImportedModelData} from '@aether/core/contracts';
import {plateProgram} from '../ai/program';

it('creates native-compatible sketch and extrusion definitions with explicit units and stable references',()=>{
  const source=createEmptyPartDocument('Agent part');
  const sketch=preparePartEdit(source,'aether_cad_sketch_rectangle',{plane:'XY',x_mm:0,y_mm:0,width_mm:40,height_mm:20});
  const extrusion=preparePartEdit(sketch.document,'aether_cad_extrude',{profile_id:sketch.featureID,depth_mm:5,operation:'new'});
  expect(source.features).toHaveLength(0);expect(extrusion.document.features).toHaveLength(2);
  expect(extrusion.document.features[1]).toMatchObject({profileFeatureId:sketch.featureID,distanceMillimeters:5,operation:'new'});
  expect(availableBodies(extrusion.document)).toHaveLength(1);
  expect(()=>preparePartEdit(sketch.document,'aether_cad_extrude',{profile_id:'unknown',depth_mm:5,operation:'new'})).toThrow(/sketch ID/);
  expect(()=>preparePartEdit(sketch.document,'aether_cad_extrude',{profile_id:sketch.featureID,depth_mm:5,operation:'cut'})).toThrow(/target_body_id/);
});
function fixture(){
  let doc=createEmptyPartDocument('Original'),key='part1';
  const model:ImportedModelData={sourceName:'Test',parseMilliseconds:1,parts:[]};
  const commit=vi.fn(next=>{doc=next;});
  const workspace:CADAgentWorkspace={current:()=>doc,contextKey:()=>key,available:()=>true,writable:()=>true,evaluate:vi.fn(async()=>model),commit,history:{candidate:()=>null,commit:vi.fn()}};
  return {workspace,commit,model,editor:new CADAgentEditor(workspace),edit:()=>{doc={...doc,name:'Human edit'};},switch:()=>{key='other';}};
}
const call={id:'one',name:'aether_cad_sketch_circle',arguments:{plane:'XY',center_x_mm:0,center_y_mm:0,radius_mm:10}};
it('native failure, cancellation and intervening edits never apply an agent candidate',async()=>{
  for(const mode of ['failure','cancel','edit','switch'] as const){
    const f=fixture(),controller=new AbortController();
    f.workspace.evaluate=async()=>{if(mode==='failure')throw Error('Native rebuild failed');if(mode==='cancel')controller.abort();if(mode==='edit')f.edit();if(mode==='switch')f.switch();return f.model;};
    await expect(f.editor.execute('part1',call,controller.signal)).rejects.toThrow();expect(f.commit).not.toHaveBeenCalled();
  }
});
it('only a successful rebuild commits, and readonly/open dialogs are respected',async()=>{
  const f=fixture();const result=await f.editor.execute('part1',call,new AbortController().signal);
  expect(f.commit).toHaveBeenCalledOnce();expect(result).toMatchObject({changed:true,feature_count:1});
  f.workspace.writable=()=>false;await expect(f.editor.execute('part1',call,new AbortController().signal)).rejects.toThrow(/read-only/);
  f.workspace.writable=()=>true;f.workspace.available=()=>false;await expect(f.editor.execute('part1',call,new AbortController().signal)).rejects.toThrow(/Finish/);
  expect(f.commit).toHaveBeenCalledOnce();
});

it('offers no premade shapes: bodies come from sketches',()=>{
  expect(cadAgentTools).toHaveLength(26); // Includes validated model projection.
  expect(cadAgentTools.some(t=>t.name==='aether_cad_solid_primitive')).toBe(false);
});

it('commits a sketched body once and allows reference inspection in a read-only Part without rebuilding',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  f.workspace.evaluate=vi.fn(async (doc:PartDocument)=>({...f.model,bodyOutputs:Object.fromEntries(doc.features.filter(feature=>feature.type==='extrude').map(feature=>[feature.id,[bodyIDForFeature(doc,feature)+':solid-1']]))}));
  const sketch=await f.editor.execute('part1',{id:'disc',name:'aether_cad_sketch_circle',arguments:{plane:'XY',center_x_mm:0,center_y_mm:0,radius_mm:8}},signal) as any;
  const result=await f.editor.execute('part1',{id:'puck',name:'aether_cad_extrude',arguments:{profile_id:sketch.feature_ids[0],depth_mm:24,operation:'new'}},signal);
  expect(result).toMatchObject({changed:true,feature_count:2});
  const features=f.workspace.current()!.features;
  f.workspace.writable=()=>false;f.workspace.available=()=>false;
  const references=await f.editor.execute('part1',{id:'refs',name:'aether_cad_feature_references',arguments:{feature_id:features[1].id}},signal);
  expect(references).toMatchObject({topology_verified:false,total:1});
  expect(f.workspace.evaluate).toHaveBeenCalledTimes(2);expect(f.commit).toHaveBeenCalledTimes(2);
  await expect(f.editor.execute('wrong-part',{id:'refs',name:'aether_cad_feature_references',arguments:{feature_id:features[1].id}},signal)).rejects.toThrow(/active Part changed/);
});

it('qualifies intermediate identities and commits a whole program once',async()=>{
  const f=fixture();
  f.workspace.evaluate=vi.fn(async (doc:PartDocument)=>({...f.model,bodyOutputs:Object.fromEntries(doc.features.filter(feature=>feature.type==='extrude').map(feature=>[feature.id,[bodyIDForFeature(doc,feature)+':solid-1']]))}));
  const result=await f.editor.execute('part1',{id:'program',name:'aether_cad_run_program',arguments:{program_json:JSON.stringify(plateProgram)}},new AbortController().signal) as any;
  expect(f.commit).toHaveBeenCalledOnce();expect(f.workspace.evaluate).toHaveBeenCalledTimes(2);
  expect(result.steps.outline.feature_id).toBe(f.workspace.current()!.features[0].id);
  expect(result.feature_count).toBe(2);
});
it('does not commit a program when native evaluation fails',async()=>{
  const f=fixture();f.workspace.evaluate=vi.fn(async()=>{throw Error('Invalid native geometry');});
  await expect(f.editor.execute('part1',{id:'program',name:'aether_cad_run_program',arguments:{program_json:JSON.stringify(plateProgram)}},new AbortController().signal)).rejects.toThrow(/Invalid native/);
  expect(f.commit).not.toHaveBeenCalled();expect(f.workspace.current()!.features).toHaveLength(0);
});
it('provides discovery and native evidence read-only without committing or touching history',async()=>{
  const f=fixture();f.workspace.writable=()=>false;f.workspace.verify=vi.fn(async()=>({changed:false,measurements:[{volume_mm3:40000}]}));
  const signal=new AbortController().signal;
  const docs=await f.editor.execute('part1',{id:'docs',name:'aether_cad_docs',arguments:{query:'program'}},signal) as any;
  expect(docs.tools.some((t:any)=>t.name==='aether_cad_run_program')).toBe(true);
  expect(await f.editor.execute('part1',{id:'verify',name:'aether_cad_verify',arguments:{}},signal)).toMatchObject({changed:false});
  expect(f.commit).not.toHaveBeenCalled();expect(f.workspace.evaluate).not.toHaveBeenCalled();
});
it.each(['cancel','changed'])('discards %s proof rather than attributing it to a later Part',async mode=>{
  const f=fixture();let finish!:(value:unknown)=>void;
  f.workspace.verify=()=>new Promise(resolve=>{finish=resolve;});
  const controller=new AbortController(),pending=f.editor.execute('part1',{id:'verify',name:'aether_cad_verify',arguments:{}},controller.signal);
  if(mode==='cancel')controller.abort();else f.workspace.current=()=>createEmptyPartDocument('Other');
  finish({changed:false});await expect(pending).rejects.toThrow();expect(f.commit).not.toHaveBeenCalled();
});

it('exposes viewport edge anchors read-only without changing history',async()=>{
  const f=fixture();
  const sketch=preparePartEdit(f.workspace.current()!,'aether_cad_sketch_rectangle',{plane:'XY',x_mm:0,y_mm:0,width_mm:40,height_mm:20});
  const pad=preparePartEdit(sketch.document,'aether_cad_extrude',{profile_id:sketch.featureID,depth_mm:5,operation:'new'});
  f.workspace.current=()=>pad.document;f.workspace.writable=()=>false;
  const bodyId=availableBodies(pad.document)[0].id;
  const anchor={start:{signature:'start'},end:{signature:'end'}};
  f.model.parts=[{id:bodyId,topology:[{id:0,surfaceType:'PLANE',candidates:[{id:'edge',kind:'edge-midpoint',label:'Edge',origin:[0,0,0],edgeAnchor:anchor}]}]} as any];
  const result=await f.editor.execute('part1',{id:'topology',name:'aether_cad_topology',arguments:{body_id:bodyId,limit:1}},new AbortController().signal) as any;
  expect(result).toMatchObject({changed:false,total_faces:1,next_offset:null});
  expect(result.faces[0].candidates[0].reference).toEqual({kind:'solid-edge',bodyId,sourceFeatureId:pad.featureID,label:'Edge',anchor});
  expect(f.commit).not.toHaveBeenCalled();expect(f.workspace.history.commit).not.toHaveBeenCalled();
  await expect(f.editor.execute('part1',{id:'missing',name:'aether_cad_topology',arguments:{body_id:'missing'}},new AbortController().signal)).rejects.toThrow('Body not found');
});

it('discards topology when the current Part changes during evaluation',async()=>{
  const f=fixture();
  const sketch=preparePartEdit(f.workspace.current()!,'aether_cad_sketch_rectangle',{plane:'XY',x_mm:0,y_mm:0,width_mm:40,height_mm:20});
  const pad=preparePartEdit(sketch.document,'aether_cad_extrude',{profile_id:sketch.featureID,depth_mm:5,operation:'new'});
  f.workspace.current=()=>pad.document;
  const bodyId=availableBodies(pad.document)[0].id;
  f.model.parts=[{id:bodyId,topology:[]}] as any;
  f.workspace.evaluate=async()=>{f.switch();return f.model;};
  await expect(f.editor.execute('part1',{id:'topology',name:'aether_cad_topology',arguments:{body_id:bodyId}},new AbortController().signal)).rejects.toThrow('The Part changed while inspecting');
  expect(f.commit).not.toHaveBeenCalled();
});
