import {describe,it,expect} from 'vitest';
import {validateSketchDrawing,solveDrawingConstraints,sketchEntityPoint,sketchEntities,dragSketchEntity,copySketchContours,similarityTransform,splitSketchSegment,trimSketchCurve,type SketchDrawing,type SketchPoint,type SketchEntityRef} from '@aether/core/sketch';
import {curveIntersections,type Curve} from '../../aether-engine/src/sketch/curves/pairs';
import {segmentPoint} from '../../aether-engine/src/sketch/curves/parameterization';
import {fixedEntityConstraint} from '../../freecad-engine/browser/fixed-geometry';
import {conicPoint,projectConic,conicDisplayPolyline,type ConicSegment} from '../../freecad-engine/browser/conic-geometry';
import {mapSketchDrawing} from '../../aether-engine/src/sketch/projection/drawing';
import {resolveDimensionExpression} from '../../aether-engine/src/sketch/solver/dimension-expressions';
import {dimensionValue} from '../../aether-engine/src/sketch/solver/dimension-links';
import {evaluateExpression} from '../../aether-engine/src/expressions/evaluate';
import {pickSketchEntity} from './picking';

const a:SketchPoint=[0,0],s=(rho=.5):ConicSegment=>({type:'conic',control:[10,20],end:[20,0],rho});
const drawing=(rho=.5):SketchDrawing=>({type:'drawing',contours:[{type:'path',id:'c',start:[...a],segments:[{...s(rho),id:'edge'}]}]});
const ref:SketchEntityRef={contour:0,kind:'curve',index:0,parameter:.5};
const segment=(d:SketchDrawing)=>{const c=d.contours[0];if(c.type!=='path'||c.segments[0].type!=='conic')throw Error('Expected conic');return c.segments[0];};
const close=(p:SketchPoint,q:SketchPoint)=>{expect(p[0]).toBeCloseTo(q[0],6);expect(p[1]).toBeCloseTo(q[1],6);};
const line=(y:number):Curve=>({start:[-10,y],segment:{type:'line',end:[30,y]}});

describe('canonical conic geometry and constraints',()=>{
 it('retains the exact conic under affine projection, including stable identities',()=>{
  const d=drawing(.8),map=(p:SketchPoint):SketchPoint=>[2*p[0]+.7*p[1]+15,.5*p[1]-3];
  const projected=mapSketchDrawing(d,{point:map,vector:(p)=>[2*p[0]+.7*p[1],.5*p[1]],determinant:1});
  const c=projected.contours[0];if(c.type!=='path'||c.segments[0].type!=='conic')throw Error();
  expect(c.id).toBe('c');expect(c.segments[0].id).toBe('edge');
  for(const t of [0,.1,.4,.8,1])close(conicPoint(c.start,c.segments[0],t),map(conicPoint(a,s(.8),t)));
 });
 it('preserves the interior turnaround in an edge-on projection rather than erasing a closed chord',()=>{
  const projection=projectConic(a,s(),p=>[p[1],0],true);
  expect(projection).toEqual([{type:'line',end:[10,0]},{type:'line',end:[0,0]}]);
 });
 it.each([.01,.5,.99])('bounds display chord error while retaining exact saved geometry at rho=%s',rho=>{
  const segment=s(rho),before=structuredClone(segment),points=conicDisplayPolyline(a,segment,.01);
  for(let i=0;i<=100;i++) {
   const p=conicPoint(a,segment,i/100);
   const distance=Math.min(...points.slice(1).map((q,j)=>{
    const b=points[j],dx=q[0]-b[0],dy=q[1]-b[1],t=Math.max(0,Math.min(1,((p[0]-b[0])*dx+(p[1]-b[1])*dy)/(dx*dx+dy*dy)));
    return Math.hypot(p[0]-b[0]-t*dx,p[1]-b[1]-t*dy);
   }));
   expect(distance).toBeLessThanOrEqual(.01);
  }
  expect(segment).toEqual(before);
 });
 it('exposes real endpoints and one tangent control, with geometric picking',()=>{
  const d=drawing();validateSketchDrawing(d);
  const controls=sketchEntities(d).filter(e=>e.ref.control!==undefined);
  expect(controls).toHaveLength(1);expect(sketchEntityPoint(d,controls[0].ref)).toEqual([10,20]);
  expect(pickSketchEntity(d,[10,20])?.ref).toEqual(controls[0].ref);
  expect(pickSketchEntity(d,[10,10])?.ref).toMatchObject(ref);
 });
 it.each([.2,.5,.8])('solves rho=%s without moving endpoints or its control',rho=>{
  const source=drawing(.4),before=structuredClone(source),next=solveDrawingConstraints({...source,constraints:[{id:'rho',kind:'conic-rho',a:ref,value:rho}]});
  expect(segment(next).rho).toBeCloseTo(rho,6);expect(segment(next).end).toEqual([20,0]);expect(segment(next).control).toEqual([10,20]);expect(source).toEqual(before);
 });
 it('moves a control point and translates the whole conic without changing rho',()=>{
  const next=dragSketchEntity(drawing(.7),{...ref,kind:'point',control:0},[4,6]);
  expect(segment(next).control).toEqual([14,26]);expect(segment(next).rho).toBe(.7);
  const moved=dragSketchEntity(drawing(.7),ref,[5,9]);
  const c=moved.contours[0];expect(c.type==='path'&&c.start).toEqual([5,9]);expect(segment(moved)).toMatchObject({control:[15,29],end:[25,9],rho:.7});
 });
 it('keeps whole-entity Fix and linked rho values authoritative',()=>{
  const source=drawing(.7);source.constraints=[fixedEntityConstraint(source,ref)];
  expect(()=>dragSketchEntity(source,{...ref,kind:'point',control:0},[1,2])).toThrow();
  const linked=drawing(.7);linked.contours.push(structuredClone(linked.contours[0]));delete linked.contours[1].id;
  linked.constraints=[{id:'one',kind:'conic-rho',a:ref,value:.3},{id:'two',kind:'conic-rho',a:{...ref,contour:1},valueFrom:'one',valueScale:2}];
  const solved=solveDrawingConstraints(linked);expect(segment(solved).rho).toBeCloseTo(.3,6);
  const c=solved.contours[1];expect(c.type==='path'&&c.segments[0].type==='conic'&&c.segments[0].rho).toBeCloseTo(.6,6);
 });
 it('supports dimensionless expressions and reference measurements; rejects length/angle units',()=>{
  const d=drawing(.7),c={id:'rho',kind:'conic-rho' as const,a:ref,value:.7};
  const value=evaluateExpression('0.8',{allowText:false,resolveVariable:()=>{throw Error('unknown');}});
  expect(resolveDimensionExpression(c,'#shape / 2',new Map([['shape',value]]))).toBe(.4);
  for(const expr of ['1 mm','2 deg'])expect(()=>resolveDimensionExpression(c,expr,new Map())).toThrow(/scalar/);
  expect(dimensionValue(d,{id:'measurement',kind:'conic-rho',a:ref,reference:true})).toBe(.7);
 });
 it('preserves rho across scaled, rotated and reflected copies',()=>{
  const source=drawing(.7);source.constraints=[{id:'rho',kind:'conic-rho',a:ref,value:.7}];
  const copied=copySketchContours(source,[0],[similarityTransform([0,0],[7,4],35,3),{a:-1,b:0,c:0,d:1,tx:0,ty:0}]);
  for(const c of copied.contours){expect(c.type==='path'&&c.segments[0].type==='conic'&&c.segments[0].rho).toBe(.7);}
  expect(copied.constraints?.map(c=>c.value)).toEqual([.7,.7,.7]);validateSketchDrawing(copied);
 });
 it.each([0,1,-.2,1.2])('rejects invalid driving rho %s atomically',value=>{
  const source=drawing(),before=structuredClone(source);
  expect(()=>solveDrawingConstraints({...source,constraints:[{id:'rho',kind:'conic-rho',a:ref,value}]})).toThrow(/rho/);expect(source).toEqual(before);
 });
});

describe('exact conic intersections and topology edits',()=>{
 it('finds two crossings and one tangency without sampled-line intersections',()=>{
  const c:Curve={start:a,segment:s()};
  const hits=curveIntersections(c,line(7.5));expect(hits.map(h=>h.first)).toEqual([.25,.75]);
  expect(curveIntersections(c,line(10))).toHaveLength(1);expect(curveIntersections(c,line(11))).toHaveLength(0);
  close(hits[0].point,[5,7.5]);close(hits[1].point,[15,7.5]);
 });
 it('intersects conic/conic and conic/cubic in both argument orders',()=>{
  const c:Curve={start:a,segment:s()},other:Curve={start:[0,15],segment:{type:'conic',end:[20,15],control:[10,-5],rho:.5}},
    cubic:Curve={start:[0,15],segment:{type:'bezier',end:[20,15],controls:[[20/3,5/3],[40/3,5/3]]}};
  for(const b of [other,cubic]) {
   const hits=curveIntersections(c,b);expect(hits).toHaveLength(2);
   for(const h of hits){close(h.point,segmentPoint(c.start,c.segment,h.first));close(h.point,segmentPoint(b.start,b.segment,h.second));}
   const reversed=curveIntersections(b,c);expect(reversed).toHaveLength(2);
  }
 });
 it('intersects circular and elliptical arcs using exact rational spans',()=>{
  const c:Curve={start:a,segment:s()},arc:Curve={start:[0,0],segment:{type:'arc',middle:[10,10],end:[20,0]}},ellipse:Curve={start:[0,0],segment:{type:'ellipse',end:[20,0],radiusX:10,radiusY:10,rotationDegrees:0,largeArc:false,sweep:false}};
  for(const other of [arc,ellipse]) {
   const hits=curveIntersections(c,other);expect(hits).toHaveLength(3);
   hits.forEach(h=>close(h.point,segmentPoint(other.start,other.segment,h.second)));
  }
 });
 it('splits unconstrained conics while keeping exact locus and contact parameters',()=>{
  const source=drawing(.8),contact=conicPoint(a,s(.8),.82);source.contours.push({type:'path',start:contact,segments:[]});
  source.constraints=[{id:'contact',kind:'coincident',a:{...ref,parameter:.82},b:{contour:1,kind:'point',index:0}}];
  const next=splitSketchSegment(source,conicPoint(a,s(.8),.37),.1);validateSketchDrawing(next);
  const r=next.constraints![0].a,c=next.contours[0];if(c.type!=='path')throw Error('path');
  close(segmentPoint(r.index===0?c.start:c.segments[r.index!-1].end,c.segments[r.index!],r.parameter!),contact);
 });
 it('trims between crossings and retains an unchanged exact conic contact',()=>{
  const source=drawing(.8),contact=conicPoint(a,s(.8),.1);source.contours.push({type:'path',start:[-5,12],segments:[{type:'line',end:[25,12]}]},{type:'path',start:contact,segments:[]});
  source.constraints=[{id:'contact',kind:'coincident',a:{...ref,parameter:.1},b:{contour:2,kind:'point',index:0}}];
  const next=trimSketchCurve(source,conicPoint(a,s(.8),.5),.1);validateSketchDrawing(next);
  const r=next.constraints![0].a,c=next.contours[r.contour];if(c.type!=='path')throw Error('path');
  close(segmentPoint(r.index===0?c.start:c.segments[r.index!-1].end,c.segments[r.index!],r.parameter!),contact);
 });
 it('refuses unsupported split remaps instead of changing a constrained conic',()=>{
  const source=drawing(.7);source.constraints=[{id:'rho',kind:'conic-rho',a:ref,value:.7}];const before=structuredClone(source);
  expect(()=>splitSketchSegment(source,conicPoint(a,s(.7),.4),.1)).toThrow(/constraints/);expect(source).toEqual(before);
 });
 it('retains a whole conic rho driver when another span in its path is trimmed',()=>{
  const source=drawing(.7),path=source.contours[0];if(path.type!=='path')throw Error();
  path.segments.push({type:'line',end:[40,0]});
  source.constraints=[{id:'rho',kind:'conic-rho',a:{...ref,parameter:undefined},value:.7}];
  const next=trimSketchCurve(source,[30,0],.1);
  expect(next.constraints).toMatchObject([{id:'rho',kind:'conic-rho',a:{contour:0,kind:'curve',index:0},value:.7}]);
  expect(segment(next)).toEqual(segment(source));validateSketchDrawing(next);
 });
 it('refuses a partial trim of a rho-driven conic with an actionable diagnostic',()=>{
  const source=drawing(.7);source.contours.push({type:'path',start:[-5,12],segments:[{type:'line',end:[25,12]}]});
  source.constraints=[{id:'rho',kind:'conic-rho',a:{...ref,parameter:undefined},value:.7}];const before=structuredClone(source);
  expect(()=>trimSketchCurve(source,conicPoint(a,s(.7),.5),.1)).toThrow(/rho dimension before trimming/);
  expect(source).toEqual(before);
 });
});
