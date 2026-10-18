import { expect, it } from 'vitest';
import { createEmptyPartDocument, type ProfileFeature } from '@aether/core/document';
import type { SketchDrawing, SketchEntityRef } from '@aether/core/sketch';
import { constraintResiduals } from '../../aether-engine/src/sketch/solver/residuals';
import { segmentPoint } from '../../aether-engine/src/sketch/curves/parameterization';
import { referenceSketchPierce } from '../../freecad-engine/browser/pierce-reference';
import { solvePierceConstraintDrafts, type PierceConstraintDraft } from '../../freecad-engine/browser/pierce-constraints';

function setup(drawing: SketchDrawing) {
  const document = createEmptyPartDocument('Pierce solve');
  const source: ProfileFeature = {id:'source',name:'Source',type:'profile',suppressed:false,plane:'XY',offsetMillimeters:0,
    profile:{type:'drawing',contours:[{type:'path',start:[0,-5],segments:[{type:'line',end:[20,5]}]}]}};
  const target: ProfileFeature = {id:'target',name:'Target',type:'profile',suppressed:false,plane:'XZ',offsetMillimeters:0,profile:drawing};
  document.features.push(source,target);
  return referenceSketchPierce(document,'target','source',0,0,0);
}
const pointDrawing = (): SketchDrawing => ({type:'drawing',contours:[{type:'path',start:[3,4],segments:[]}]});
const point: SketchEntityRef = {contour:0,kind:'point',index:0};
function solve(drawing: SketchDrawing, a: SketchEntityRef = point) {
  const selected=setup(drawing);
  const draft: PierceConstraintDraft={id:'pierce-1',kind:'pierce',a,source:selected.reference};
  return {...solvePierceConstraintDrafts(selected.document.features,'target',drawing,[draft]),selected,draft};
}
it('attaches a point without adding a saved point snapshot or temporary equation',()=>{
  const drawing=pointDrawing(),before=structuredClone(drawing),result=solve(drawing);
  expect(result.drawing.contours).toHaveLength(1);expect(result.drawing.constraints).toBeUndefined();
  expect(result.drawing.contours[0]).toMatchObject({start:[expect.closeTo(10,7),expect.closeTo(0,7)],segments:[]});
  expect(result.constraints[0]).toEqual(result.draft);expect(drawing).toEqual(before);
  expect(JSON.stringify(result.constraints)).not.toContain('worldPoint');
});
it('follows a moved source and preserves existing target dimensions',()=>{
  const drawing: SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[6,0]}]}],constraints:[
    {id:'horizontal',kind:'horizontal',a:{contour:0,kind:'line',index:0}},
    {id:'length',kind:'length',a:{contour:0,kind:'line',index:0},value:6},
  ]};
  const first=solve(drawing),source=first.selected.document.features[0] as ProfileFeature;
  if(source.profile.type!=='drawing'||source.profile.contours[0].type!=='path')throw Error();
  source.profile.contours[0].segments[0].end=[40,5];
  const result=solvePierceConstraintDrafts(first.selected.document.features,'target',first.drawing,first.constraints);
  const contour=result.drawing.contours[0];if(contour.type!=='path')throw Error();
  expect(contour.start[0]).toBeCloseTo(20,7);expect(contour.segments[0].end[0]).toBeCloseTo(26,7);
  for(const c of result.drawing.constraints!)expect(Math.max(...constraintResiduals(result.drawing,c).map(Math.abs))).toBeLessThan(1e-7);
  expect(source.profile.contours[0].start).toEqual([0,-5]);
});
it('rejects a conflicting Fix atomically',()=>{
  const drawing=pointDrawing();drawing.constraints=[{id:'fixed',kind:'fix',a:point,point:[3,4]}];
  const before=structuredClone(drawing),selected=setup(drawing),features=structuredClone(selected.document.features);
  expect(()=>solvePierceConstraintDrafts(selected.document.features,'target',drawing,[{id:'pierce',kind:'pierce',a:point,source:selected.reference}])).toThrow(/conflict|converge/);
  expect(drawing).toEqual(before);expect(selected.document.features).toEqual(features);
});
it('constrains a circle edge independently from its center',()=>{
  const drawing:SketchDrawing={type:'drawing',contours:[{type:'circle',center:[0,0],radius:7}],constraints:[{id:'radius',kind:'radius',a:{contour:0,kind:'circle'},value:7}]};
  const result=solve(drawing,{contour:0,kind:'circle'}),circle=result.drawing.contours[0];if(circle.type!=='circle')throw Error();
  expect(Math.hypot(circle.center[0]-10,circle.center[1])).toBeCloseTo(7,7);expect(circle.radius).toBeCloseTo(7,7);
  const center=solve(drawing,{contour:0,kind:'point',index:0}).drawing.contours[0];if(center.type!=='circle')throw Error();
  expect(center.center[0]).toBeCloseTo(10,7);expect(center.radius).toBeCloseTo(7,7);
});
it.each([
  {type:'line' as const,end:[8,4] as [number,number]},
  {type:'arc' as const,middle:[4,6] as [number,number],end:[8,0] as [number,number]},
  {type:'ellipse' as const,end:[8,0] as [number,number],radiusX:5,radiusY:4,rotationDegrees:0,largeArc:false,sweep:true},
  {type:'bezier' as const,end:[8,0] as [number,number],controls:[[2,8],[6,8]] as [[number,number],[number,number]]},
  ...[.25,.5,.75].map(rho=>({type:'conic' as const,end:[8,0] as [number,number],control:[4,8] as [number,number],rho})),
])('attaches to a finite $type curve with a sliding contact',segment=>{
  const drawing:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[segment]}]};
  const result=solve(drawing,{contour:0,kind:'curve',index:0,parameter:.5}),ref=result.constraints[0].a;
  const path=result.drawing.contours[0];if(path.type!=='path')throw Error();
  expect(ref.sliding).toBe(true);expect(ref.parameter).toBeGreaterThanOrEqual(0);expect(ref.parameter).toBeLessThanOrEqual(1);
  const at=segmentPoint(path.start,path.segments[0],ref.parameter!);
  expect(Math.hypot(at[0]-10,at[1])).toBeLessThan(1e-7);
});
it('does not attach to the infinite extension of a fixed segment',()=>{
  const drawing:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[5,0]}]}],constraints:[
    {id:'a',kind:'fix',a:point,point:[0,0]},
    {id:'b',kind:'fix',a:{...point,index:1},point:[5,0]},
  ]};
  expect(()=>solve(drawing,{contour:0,kind:'line',index:0})).toThrow(/conflict|converge/);
});
it('does not move source geometry to satisfy conflicting target constraints',()=>{
  const drawing=pointDrawing(),selected=setup(drawing),before=structuredClone(selected.document);
  const draft: PierceConstraintDraft={id:'one',kind:'pierce',a:point,source:selected.reference};
  // Another branch of the same full-circle source gives a different isolated point.
  const source=selected.document.features[0] as ProfileFeature;
  source.profile={type:'drawing',contours:[{type:'circle',id:'circle',center:[0,0],radius:5}]};
  const a=referenceSketchPierce(selected.document,'target','source',0,undefined,0);
  const b=referenceSketchPierce(a.document,'target','source',0,undefined,1);
  const input=structuredClone(b.document);
  expect(()=>solvePierceConstraintDrafts(b.document.features,'target',drawing,[{...draft,source:a.reference},{...draft,id:'two',source:b.reference}])).toThrow(/conflict|converge/);
  expect(b.document).toEqual(input);expect(before.features[0]).not.toEqual(source);
});
it('rejects vanished sources before touching target geometry',()=>{
  const result=solve(pointDrawing()),before=structuredClone(result.drawing);
  result.selected.document.features[0].suppressed=true;
  expect(()=>solvePierceConstraintDrafts(result.selected.document.features,'target',result.drawing,result.constraints)).toThrow(/suppressed/);
  expect(result.drawing).toEqual(before);
});
it.each([
  {contour:-1,projectedContourId:'foreign',kind:'point',index:0},
  {contour:1,kind:'point',index:0},
  {contour:0,kind:'contour'},
  {contour:0,kind:'point',index:5},
  {contour:0,kind:'point',index:0,parameter:.5},
])('refuses invalid/read-only target $kind $index',ref=>{
  expect(()=>solve(pointDrawing(),ref as SketchEntityRef)).toThrow();
});
it('cannot select an internal source point introduced by another draft',()=>{
  const drawing=pointDrawing(),selected=setup(drawing),draft: PierceConstraintDraft={id:'one',kind:'pierce',a:point,source:selected.reference};
  expect(()=>solvePierceConstraintDrafts(selected.document.features,'target',drawing,[draft,{...draft,id:'two',a:{...point,contour:1}}])).toThrow();
});
it('resolves stable target segment IDs after unrelated insertion',()=>{
  const drawing:SketchDrawing={type:'drawing',contours:[{type:'path',start:[-5,-5],segments:[{id:'other',type:'line',end:[0,0]},{id:'target-line',type:'line',end:[20,0]}]}]};
  const result=solve(drawing,{contour:0,kind:'line',index:0,segmentId:'target-line'});
  expect(result.constraints[0].a.index).toBe(1);expect(result.constraints[0].a.parameter).toBeCloseTo(.5,7);
  expect(result.drawing).toEqual(drawing);
});
it('keeps ordinary projected constraints as read-only inputs',()=>{
  const drawing=pointDrawing();drawing.contours.push({type:'path',start:[0,0],segments:[]});
  drawing.projectionContext=[{id:'reference',type:'path',start:[-3,2],segments:[]}];
  drawing.constraints=[{id:'projected',kind:'coincident',a:{...point,contour:1},b:{contour:-1,projectedContourId:'reference',kind:'point',index:0}}];
  const result=solve(drawing);expect(result.drawing.projectionContext).toEqual(drawing.projectionContext);
  expect(result.drawing.contours[1]).toMatchObject({start:[expect.closeTo(-3,7),expect.closeTo(2,7)]});
});
it('preserves rho and an angular-independent shape while seeding a distant conic',()=>{
  const drawing:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'conic',end:[8,0],control:[4,8],rho:.5}]}],constraints:[
    {id:'rho',kind:'conic-rho',a:{contour:0,kind:'curve',index:0},value:.5,valueExpression:'0.5'},
  ]};
  const result=solve(drawing,{contour:0,kind:'curve',index:0,parameter:.5});
  const contour=result.drawing.contours[0];if(contour.type!=='path'||contour.segments[0].type!=='conic')throw Error();
  expect(contour.segments[0].rho).toBeCloseTo(.5,8);
  expect(result.drawing.constraints).toEqual(drawing.constraints);
});
it('preserves an already satisfied fixed curve and its finite contact',()=>{
  const drawing:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[20,0]}]}],constraints:[
    {id:'a',kind:'fix',a:point,point:[0,0]},
    {id:'b',kind:'fix',a:{...point,index:1},point:[20,0]},
  ]};
  const result=solve(drawing,{contour:0,kind:'line',index:0});
  expect(result.drawing).toEqual(drawing);expect(result.constraints[0].a.parameter).toBeCloseTo(.5,8);
});
it.each(['ordinary','draft'])('rejects duplicate %s identities without any edit',kind=>{
  const drawing=pointDrawing(),selected=setup(drawing),draft: PierceConstraintDraft={id:'one',kind:'pierce',a:point,source:selected.reference};
  if(kind==='ordinary')drawing.constraints=[{id:'one',kind:'fix',a:point,point:[3,4]}];
  const before=structuredClone(drawing);
  expect(()=>solvePierceConstraintDrafts(selected.document.features,'target',drawing,kind==='ordinary'?[draft]:[draft,draft])).toThrow(/unique/);
  expect(drawing).toEqual(before);
});
