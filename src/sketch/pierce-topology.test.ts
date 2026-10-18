import fs from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument,resolveProfileDrawing,type PartDocument,type ProfileFeature} from '@aether/core/document';
import {splitSketchSegment,splitSketchCircle,trimSketchCurve,solveDrawingConstraints,type SketchDrawing,type SketchSegment,type SketchPoint} from '@aether/core/sketch';
import {segmentPoint} from '../../aether-engine/src/sketch/curves/parameterization';
import {constraintResiduals} from '../../aether-engine/src/sketch/solver/residuals';
import {addSketchPierce} from '../../freecad-engine/browser/pierce-authoring';
import {translateDocument} from '../freecad-translate';

const captures:{name:string;document:PartDocument;features:ReturnType<typeof translateDocument>['features']}[]=[];
afterAll(()=>{if(process.env.AETHER_PIERCE_TOPOLOGY_FIXTURES)fs.writeFileSync(process.env.AETHER_PIERCE_TOPOLOGY_FIXTURES,JSON.stringify(captures,null,2)+'\n');});
function capture(name:string,document:PartDocument){const result=translateDocument(document);expect(result.complete).toBe(true);captures.push({name,document,features:result.features});}

const segments:SketchSegment[]=[
 {type:'line',end:[4,0]},
 {type:'arc',middle:[2,2],end:[4,0]},
 {type:'ellipse',radiusX:2,radiusY:1,rotationDegrees:0,largeArc:false,sweep:true,end:[4,0]},
 {type:'bezier',controls:[[1,2],[3,2]],end:[4,0]},
 {type:'conic',control:[2,4],rho:.7,end:[4,0]},
];
function part(drawing:SketchDrawing,contact:SketchPoint):PartDocument {
 const doc=createEmptyPartDocument('Pierce editing');
 doc.features=[
  {id:'source',name:'Source',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,
   frame:{originMillimeters:[0,0,contact[1]],normal:[0,0,1],xDirection:[1,0,0]},
   profile:{type:'drawing',contours:[{type:'path',start:[contact[0],-5],segments:[{type:'line',end:[contact[0],5]}]}]}},
  {id:'target',name:'Target',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:drawing},
 ];return doc;
}
const resolved=(d:PartDocument)=>resolveProfileDrawing(d.features,'target');
function save(doc:PartDocument,drawing:SketchDrawing){const next=structuredClone(doc),saved=structuredClone(drawing);delete saved.pierceContext;delete saved.projectionContext;(next.features[1] as ProfileFeature).profile=saved;return parsePartDocument(serializePartDocument(next));}
function satisfied(d:SketchDrawing){for(const c of d.constraints??[])expect(constraintResiduals(d,c).every(r=>Math.abs(r)<1e-6),c.id).toBe(true);}

it.each(segments)('preserves a finite $type Pierce contact across both split halves and reopen',segment=>{
 for(const t of [.25,.5,.75]) {
  const start:SketchPoint=[0,0],contact=segmentPoint(start,segment,t);
  const doc=addSketchPierce(part({type:'drawing',contours:[{type:'path',id:'target-path',start,segments:[{...segment,id:'target-edge'}]}]},contact),'target',{kind:'curve',contour:0,index:0,segmentId:'target-edge',parameter:t},'source',0,0,0);
  const before=structuredClone(doc),drawing=resolved(doc),relation=drawing.constraints![0];
  const next=splitSketchSegment(drawing,segmentPoint(start,segment,.5),.001),saved=save(doc,next),result=resolved(saved),constraint=result.constraints!.find(c=>c.id===relation.id)!;
  expect(constraint.source).toEqual(relation.source);expect(constraint.a.index).toBe(t<=.5?0:1);expect(constraint.a.segmentId).not.toBe('target-edge');
  satisfied(result);expect(solveDrawingConstraints(result).contours).toEqual(result.contours);expect(doc).toEqual(before);
  capture(`split-${segment.type}-${t}`,saved);
 }
});
it.each(segments)('retains only surviving finite $type contacts when trimming',segment=>{
 for(const t of [.1,.5,.9]) {
  const start:SketchPoint=[0,0],contact=segmentPoint(start,segment,t),drawing:SketchDrawing={type:'drawing',contours:[{type:'path',start,segments:[segment]}]};
  for(const x of [1,3])drawing.contours.push({type:'path',construction:true,start:[x,-10],segments:[{type:'line',end:[x,10]}]});
  const doc=addSketchPierce(part(drawing,contact),'target',{kind:'curve',contour:0,index:0,parameter:t},'source',0,0,0);
  const next=trimSketchCurve(resolved(doc),segmentPoint(start,segment,.55),.001),saved=save(doc,next),result=resolved(saved);
  expect(result.constraints!.filter(c=>c.kind==='pierce')).toHaveLength(t===.5?0:1);satisfied(result);
  capture(`trim-${segment.type}-${t}`,saved);
 }
});
it.each(([[0,3],[0,-3],[3,0]] as SketchPoint[]).map(contact=>({contact})))('selects the actual containing arc after splitting a Pierce circle at $contact',({contact})=>{
 const doc=addSketchPierce(part({type:'drawing',contours:[{type:'circle',center:[0,0],radius:3}],constraints:[{id:'r',kind:'radius',a:{kind:'circle',contour:0},value:3}]},contact),'target',{kind:'circle',contour:0},'source',0,0,0);
 const next=splitSketchCircle(resolved(doc),0,[3,0],[-3,0]),result=resolved(save(doc,next));
 const c=result.constraints!.find(c=>c.kind==='pierce')!;expect(c.a.kind).toBe('curve');expect(c.a.sliding).toBe(true);expect(c.a.index).toBe(contact[1]<0?1:0);
 expect(result.contours).toHaveLength(1);satisfied(result);
});
it.each([true,false])('trimming a circle keeps its Pierce exactly when the contact survives (%s)',keep=>{
 const drawing:SketchDrawing={type:'drawing',contours:[{type:'circle',center:[0,0],radius:3},{type:'path',construction:true,start:[-5,0],segments:[{type:'line',end:[5,0]}]}]};
 const doc=addSketchPierce(part(drawing,[0,keep?-3:3]),'target',{kind:'circle',contour:0},'source',0,0,0);
 const next=trimSketchCurve(resolved(doc),[0,3],.001),result=resolved(save(doc,next));
 expect(result.constraints!.filter(c=>c.kind==='pierce')).toHaveLength(keep?1:0);satisfied(result);
});
it('keeps circle-center Pierce references separate from finite circumference targets after splitting',()=>{
 const doc=addSketchPierce(part({type:'drawing',contours:[{type:'circle',center:[0,0],radius:3}]},[0,0]),'target',{kind:'point',contour:0,index:0},'source',0,0,0);
 const result=resolved(save(doc,splitSketchCircle(resolved(doc),0,[3,0],[-3,0])));
 expect(result.constraints!.find(c=>c.kind==='pierce')!.a).toMatchObject({kind:'point',contour:1,index:0});satisfied(result);
});
it('does not silently retarget an external source when that source edge is split',()=>{
 const doc=addSketchPierce(part({type:'drawing',contours:[{type:'circle',center:[0,0],radius:3}]},[0,0]),'target',{kind:'point',contour:0,index:0},'source',0,0,0);
 const source=doc.features[0] as ProfileFeature;source.profile=splitSketchSegment(resolveProfileDrawing(doc.features,'source'),[0,2],.001);
 expect(()=>resolved(doc)).toThrow(/missing|reselect/i);
 // The orphan remains explicit and cannot evaluate, but its definition is
 // saveable so the upstream edit can be committed and repaired afterwards.
 expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
});
it.each([0,1] as const)('preserves cubic control %s and its original scaled handle through split and reopen',control=>{
 const segment:SketchSegment={type:'bezier',controls:[[1,2],[3,2]],end:[4,0]},point=segment.controls[control];
 const doc=addSketchPierce(part({type:'drawing',contours:[{type:'path',start:[0,0],segments:[segment]}]},point),'target',{kind:'point',contour:0,index:0,control},'source',0,0,0);
 const next=splitSketchSegment(resolved(doc),segmentPoint([0,0],segment,.4),.001),saved=save(doc,next),result=resolved(saved),constraint=result.constraints!.find(c=>c.kind==='pierce')!;
 expect(constraint.a.index).toBe(control);expect(constraint.a.controlScale).toBeCloseTo(1/(control===0?.4:.6),6);satisfied(result);capture(`split-control-${control}`,saved);
});
