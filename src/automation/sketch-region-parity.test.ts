import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, sketchRegions, type PartDocument, type ProfileFeature } from '@aether/core/document';
import { initNodeKernel, solidMeasures } from '@aether/core/kernel/node';
import { evaluatePartDocument } from '@aether/core/kernel';
import { preparePartEdit } from './live-commands';
import { inspectSketch } from './sketch-edit';
import { stampProfileSelections } from '../features/regions';
import type { FeatureEditorContext } from '../features/shared';
import { profileRegionIdentity } from '@aether/core/sketch/reference/profile-region-reference';

beforeAll(async()=>{await initNodeKernel(readFileSync(new URL('../../aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm',import.meta.url)));});
const source=():PartDocument=>{
 const doc=createEmptyPartDocument('Region parity');
 doc.features=[{id:'s',name:'Sketch',type:'profile',suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'drawing',contours:[
  {id:'rect',type:'path',start:[0,-10],segments:[{type:'line',end:[20,-10]},{type:'line',end:[20,10]},{type:'line',end:[0,10]},{type:'line',end:[0,-10]}]},
  {id:'circle',type:'circle',center:[20,0],radius:10},
 ],constraints:[{id:'radius',kind:'radius',a:{kind:'circle',contour:1},value:10}]}}];return doc;
};
function measure(doc:PartDocument) {
 let volume=0;let bounds:unknown;
 const model=evaluatePartDocument(doc,{withBodies:bodies=>{for(const body of bodies.values()){volume+=solidMeasures(body).volume_mm3;bounds=body.boundingBox.bounds;}}});
 return {volume,bounds,bodyIDs:model.parts.map(part=>part.id)};
}
const extrude=(doc:PartDocument,extra:Record<string,unknown>={})=>preparePartEdit(doc,'aether_cad_extrude',{profile_id:'s',depth_mm:5,operation:'new',...extra});

it('requires an explicit choice for overlapping regions without mutating the source',()=>{
 const doc=source(),before=serializePartDocument(doc);
 expect(()=>extrude(doc)).toThrow(/multiple closed regions/);
 for(const profile_point_mm of [[20,0],[100,100],[NaN,0],[1],[1,2,3]])expect(()=>extrude(doc,{profile_point_mm})).toThrow();
 expect(()=>extrude(doc,{profile_point_mm:[15,0],all_regions:true})).toThrow(/not both/);
 expect(()=>extrude(doc,{all_regions:'yes'})).toThrow(/true or false/);
 expect(serializePartDocument(doc)).toBe(before);
});

it('uses the same persistent cell identity as the UI and follows dimensions through save/reopen',()=>{
 const doc=source(),before=serializePartDocument(doc);
 const agent=extrude(doc,{profile_point_mm:[15,0]}).document;
 const selection=(agent.features[1] as any).profileSelections[0];
 const ui={doc:structuredClone(doc)} as FeatureEditorContext;
 const region=sketchRegions(doc.features[0],false,doc.features).find(r=>r.insideContourIndices?.length===2)!;
 const picked=stampProfileSelections(ui,[{featureId:'s',contourIndex:region.contourIndex}])[0];
 expect(profileRegionIdentity(selection)).toBe(profileRegionIdentity(picked));
 expect(measure(agent).volume).toBeCloseTo(Math.PI*250,5);
 const changed=preparePartEdit(agent,'aether_cad_sketch_dimension',{feature_id:'s',dimension_id:'radius',value:8}).document;
 const reopened=parsePartDocument(serializePartDocument(changed));
 expect(measure(reopened).volume).toBeCloseTo(Math.PI*160,5);
 expect(measure(reopened).bodyIDs).toEqual(measure(agent).bodyIDs);
 expect(serializePartDocument(doc)).toBe(before);
});

it('selects all arrangement cells explicitly without counting the overlap twice',()=>{
 const doc=extrude(source(),{all_regions:true}).document;
 expect((doc.features[1] as any).profileSelections).toHaveLength(3);
 expect(measure(doc).volume).toBeCloseTo((400+Math.PI*50)*5,5);
});

it('distinguishes a ring from its disc and preserves holes',()=>{
 const doc=source(),profile=(doc.features[0] as ProfileFeature).profile as any;
 profile.contours[1].center=[10,0];profile.contours[1].radius=4;profile.constraints=[];
 expect(measure(extrude(doc,{profile_point_mm:[2,0]}).document).volume).toBeCloseTo((400-Math.PI*16)*5,5);
 expect(measure(extrude(doc,{profile_point_mm:[10,0]}).document).volume).toBeCloseTo(Math.PI*16*5,5);
});

it('stamps absent source identities only on the candidate and refuses a disappeared region',()=>{
 const doc=source(); const drawing=(doc.features[0] as ProfileFeature).profile as any;
 for(const c of drawing.contours)delete c.id;
 const agent=extrude(doc,{profile_point_mm:[15,0]}).document;
 expect(drawing.contours.every((c:any)=>!c.id)).toBe(true);
 const profile=(agent.features[0] as ProfileFeature).profile as any;
 expect(profile.contours.every((c:any)=>c.id)).toBe(true);
 profile.contours[1].center=[60,0];
 expect(()=>measure(agent)).toThrow(/no longer form/);
});

it('paginates read-only region inspection alongside contours and constraints',()=>{
 const doc=source(),before=serializePartDocument(doc);
 const first=inspectSketch(doc,{feature_id:'s',offset:0,limit:1});
 expect(first.regions).toMatchObject({total:3,offset:0,next_offset:1});
 expect(first.regions.items).toHaveLength(1);
 expect(first.regions.items[0]).toMatchObject({selectable:true,boundary:{type:'path'}});
 expect(inspectSketch(doc,{feature_id:'s',offset:2,limit:1}).regions.next_offset).toBe(null);
 expect(serializePartDocument(doc)).toBe(before);
 const projected:ProfileFeature={id:'projected',type:'profile',name:'Projection',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'projection',sourceFeatureId:'s'}};
 doc.features.push(projected);
 const regions=inspectSketch(doc,{feature_id:'projected'}).regions;
 expect(regions.total).toBe(3);
 expect(regions.items.every(region=>!region.selectable)).toBe(true);
});

it('places and flips an explicit-frame sketch before exact extrusion in world space',()=>{
 const base=createEmptyPartDocument('Placed');
 const sketch=preparePartEdit(base,'aether_cad_sketch_rectangle',{frame:{origin_mm:[10,20,30],x_direction:[0,1,0],y_direction:[0,0,1]},offset_mm:2,flip:'x',x_mm:0,y_mm:0,width_mm:4,height_mm:6});
 expect(sketch.document.features[0]).toMatchObject({frame:{originMillimeters:[12,20,30],normal:[1,0,0]},flip:'x'});
 expect(inspectSketch(sketch.document,{feature_id:sketch.featureID})).toMatchObject({frame:{originMillimeters:[12,20,30]},flip:'x',offset_mm:2});
 const pad=preparePartEdit(sketch.document,'aether_cad_extrude',{profile_id:sketch.featureID,depth_mm:5,operation:'new'});
 const result=measure(parsePartDocument(serializePartDocument(pad.document)));
 expect(result.volume).toBeCloseTo(120,5);
 const bounds=result.bounds as number[][];
 for(const [i,values] of [[7,20,24],[12,24,30]].entries())for(let j=0;j<3;j++)expect(bounds[i][j]).toBeCloseTo(values[j],5);
});

it('refuses malformed and contradictory frames without adding a sketch',()=>{
 const doc=createEmptyPartDocument('Refusal');
 const valid={origin_mm:[0,0,0],x_direction:[1,0,0],y_direction:[0,1,0]};
 for(const placement of [
  {frame:{...valid,x_direction:[2,0,0]}},{frame:{...valid,y_direction:[1,0,0]}},
  {frame:{...valid,origin_mm:[NaN,0,0]}},{frame:{...valid,z_direction:[0,0,1]}},
  {plane:'XY',frame:valid},{frame:valid,flip:true},{frame:valid,offset_mm:Infinity},{},
 ])expect(()=>preparePartEdit(doc,'aether_cad_sketch_circle',{...placement,center_x_mm:0,center_y_mm:0,radius_mm:5})).toThrow();
 expect(doc.features).toHaveLength(0);
});

it('does not mistake the inside of a circular hole for the surrounding ring near a display chord',()=>{
 const doc=source(),profile=(doc.features[0] as ProfileFeature).profile as any;
 profile.contours[1].center=[10,0];profile.contours[1].radius=4;profile.constraints=[];
 const a=Math.PI/48,point=[10+3.9999*Math.cos(a),3.9999*Math.sin(a)];
 expect(measure(extrude(doc,{profile_point_mm:point}).document).volume).toBeCloseTo(Math.PI*16*5,5);
});

it('revolves the selected disc independently of its surrounding region',()=>{
 const doc=source(),profile=(doc.features[0] as ProfileFeature).profile as any;
 profile.contours[1].center=[10,5];profile.contours[1].radius=2;profile.constraints=[];
 const result=preparePartEdit(doc,'aether_cad_revolve',{profile_id:'s',profile_point_mm:[10,5],axis:'X',angle_deg:360,operation:'new'});
 expect(measure(result.document).volume).toBeCloseTo(40*Math.PI*Math.PI,5);
 expect(measure(parsePartDocument(serializePartDocument(result.document))).volume).toBeCloseTo(40*Math.PI*Math.PI,5);
 expect(()=>preparePartEdit(doc,'aether_cad_revolve',{profile_id:'s',axis:'X',angle_deg:360,operation:'new'})).toThrow(/multiple closed regions/);
});

it('cuts and adds a selected disc on a body face, preserving the body and following an upstream dimension',()=>{
 const outline=preparePartEdit(createEmptyPartDocument('Plate'),'aether_cad_sketch_rectangle',{plane:'XY',x_mm:0,y_mm:-10,width_mm:20,height_mm:20});
 const pad=preparePartEdit(outline.document,'aether_cad_extrude',{profile_id:outline.featureID,depth_mm:5,operation:'new'}).document;
 const target=measure(pad).bodyIDs[0];
 const sketch=source().features[0] as ProfileFeature;
 sketch.offsetMillimeters=5;
 const drawing=sketch.profile as any;
 drawing.contours[1].center=[10,0];drawing.contours[1].radius=4;drawing.constraints[0].value=4;
 pad.features.push(sketch);
 const before=serializePartDocument(pad);
 for(const operation of ['cut','add']) {
  const result=extrude(pad,{profile_point_mm:[10,0],operation,depth_mm:2,target_body_id:target}).document;
  expect(measure(result).volume).toBeCloseTo(2000+(operation==='cut'?-1:1)*Math.PI*32,5);
  expect(measure(result).bodyIDs).toEqual([target]);
  const changed=preparePartEdit(result,'aether_cad_sketch_dimension',{feature_id:'s',dimension_id:'radius',value:3}).document;
  expect(measure(parsePartDocument(serializePartDocument(changed))).volume).toBeCloseTo(2000+(operation==='cut'?-1:1)*Math.PI*18,5);
 }
 expect(serializePartDocument(pad)).toBe(before);
});
