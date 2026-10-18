import { expect, it } from 'vitest';
import type { SketchFrame, SketchPoint } from '@aether/core/sketch';
import { pierceBranch, pierceCurvePlane, resolvePierceBranch, type PierceCurve } from '../../freecad-engine/browser/pierce-geometry';

const xy:SketchFrame={originMillimeters:[0,0,0],xDirection:[1,0,0],normal:[0,0,1]};
const xz:SketchFrame={originMillimeters:[0,0,0],xDirection:[1,0,0],normal:[0,-1,0]};
const line=(start:SketchPoint,end:SketchPoint):PierceCurve=>({type:'segment',start,segment:{type:'line',end}});
const cubic=(ys:number[]):PierceCurve=>({type:'segment',start:[0,ys[0]],segment:{type:'bezier',controls:[[10/3,ys[1]],[20/3,ys[2]]],end:[10,ys[3]]}});
const close=(actual:readonly number[],expected:readonly number[])=>{expect(actual).toHaveLength(expected.length);actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],7));};

it('intersects the finite source in world space rather than flattening it',()=>{
  const [hit]=pierceCurvePlane(line([0,-5],[20,5]),xy,xz);
  close(hit.point,[10,0]);close(hit.worldPoint,[10,0,0]);expect(hit.parameter).toBe(.5);expect(hit.direction).toBe(-1);
  expect(pierceCurvePlane(line([0,2],[20,5]),xy,xz)).toEqual([]);
});
it('resolves target-plane translation and local coordinates',()=>{
  const target={...xz,originMillimeters:[3,2,4] as [number,number,number]};
  const [hit]=pierceCurvePlane(line([0,-5],[20,5]),xy,target);
  close(hit.worldPoint,[14,2,0]);close(hit.point,[11,-4]);
});
it('remains invariant under a common arbitrary rigid placement',()=>{
  const n=Math.sqrt(.5),rotate=(v:readonly number[]):[number,number,number]=>[v[0]*n-v[2]*n,v[1],v[0]*n+v[2]*n];
  const frame=(f:SketchFrame):SketchFrame=>({originMillimeters:rotate(f.originMillimeters).map((v,i)=>v+[32,-17,91][i]) as [number,number,number],xDirection:rotate(f.xDirection),normal:rotate(f.normal)});
  const [hit]=pierceCurvePlane(line([0,-5],[20,5]),frame(xy),frame(xz));close(hit.point,[10,0]);close(hit.worldPoint,[32+10*n,-17,91+10*n]);
});
it('finds both full-circle crossings without duplicating its seam',()=>{
  const hits=pierceCurvePlane({type:'circle',center:[0,0],radius:5},xy,xz);
  expect(hits).toHaveLength(2);close(hits[0].worldPoint,[5,0,0]);close(hits[1].worldPoint,[-5,0,0]);expect(hits.map(h=>h.direction)).toEqual([-1,1]);
});
it('retains a full-circle branch across the parameter seam',()=>{
  const curve:PierceCurve={type:'circle',center:[0,0],radius:5},before=pierceCurvePlane(curve,xy,xz),branch=pierceBranch(before,0);
  const moved=pierceCurvePlane(curve,xy,{...xz,originMillimeters:[0,-.1,0]});
  const selected=resolvePierceBranch(moved,branch);expect(selected.parameter).toBeGreaterThan(.9);close(selected.worldPoint,[Math.sqrt(24.99),-.1,0]);
});
it('distinguishes tangency, no intersection and coplanarity',()=>{
  const curve:PierceCurve={type:'circle',center:[0,5],radius:5};
  const hits=pierceCurvePlane(curve,xy,xz);expect(hits).toHaveLength(1);expect(hits[0].direction).toBe(0);close(hits[0].worldPoint,[0,0,0]);
  expect(pierceCurvePlane({...curve,center:[0,6]},xy,xz)).toEqual([]);
  expect(()=>pierceCurvePlane(curve,xy,xy)).toThrow(/lies in/);
  expect(()=>pierceCurvePlane(line([0,0],[20,0]),xy,xz)).toThrow(/lies in/);
});
it('respects finite circular arc extents',()=>{
  const upper:PierceCurve={type:'segment',start:[5,0],segment:{type:'arc',middle:[0,5],end:[-5,0]}};
  expect(pierceCurvePlane(upper,xy,{...xz,originMillimeters:[0,-2,0]})).toEqual([]);
  const hits=pierceCurvePlane(upper,xy,{...xz,originMillimeters:[0,3,0]});expect(hits).toHaveLength(2);
  close(hits[0].worldPoint,[4,3,0]);close(hits[1].worldPoint,[-4,3,0]);
});
it('intersects a rotated elliptical arc using its analytic frame',()=>{
  const n=Math.sqrt(.5),curve:PierceCurve={type:'segment',start:[10*n,10*n],segment:{type:'ellipse',end:[-10*n,-10*n],radiusX:10,radiusY:4,rotationDegrees:45,largeArc:false,sweep:true}};
  const hits=pierceCurvePlane(curve,xy,xz);expect(hits).toHaveLength(1);
  close(hits[0].worldPoint,[-40*Math.sqrt(2)/Math.sqrt(116),0,0]);
});
it('finds all three cubic crossings and retains the selected signed branch',()=>{
  const hits=pierceCurvePlane(cubic([-8,14,-14,8]),xy,xz);expect(hits).toHaveLength(3);
  close(hits.map(h=>h.parameter),[.2,.5,.8]);expect(hits.map(h=>h.direction)).toEqual([-1,1,-1]);
  const branch=pierceBranch(hits,2);expect(branch).toEqual({direction:-1,ordinal:1,counts:[2,0,1]});
  const changed=pierceCurvePlane(cubic([-8,16,-14,8]),xy,xz);expect(resolvePierceBranch(changed,branch).parameter).toBeGreaterThan(.7);
  expect(()=>resolvePierceBranch(pierceCurvePlane(cubic([-8,-2,2,8]),xy,xz),branch)).toThrow(/changed branches/);
});
it.each([{ys:[2,-2/3,-2/3,2]},{ys:[-1,1,-1,1]}])('handles repeated cubic roots without duplicate contacts: $ys',({ys})=>{
  const hits=pierceCurvePlane(cubic(ys),xy,xz);expect(hits).toHaveLength(1);expect(hits[0].parameter).toBeCloseTo(.5,7);
  expect(hits[0].direction).toBe(ys[0]>0?0:-1);
});
it('intersects exact rational conics without using their display polylines',()=>{
  const curve:PierceCurve={type:'segment',start:[10,0],segment:{type:'conic',end:[0,10],control:[10,10],rho:Math.SQRT1_2/(1+Math.SQRT1_2)}};
  const hits=pierceCurvePlane(curve,xy,{...xz,originMillimeters:[0,5,0]});expect(hits).toHaveLength(1);close(hits[0].worldPoint,[Math.sqrt(75),5,0]);
});
it('rejects invalid frames, coordinates and malformed branch references',()=>{
  expect(()=>pierceCurvePlane(line([0,-5],[10,5]),xy,{...xz,normal:[0,-2,0]})).toThrow(/frames/);
  expect(()=>pierceCurvePlane(line([NaN,0],[10,5]),xy,xz)).toThrow(/finite/);
  const hits=pierceCurvePlane(line([0,-5],[10,5]),xy,xz);
  expect(()=>pierceBranch(hits,3)).toThrow(/existing/);
  for(const branch of [{direction:1,ordinal:0,counts:[1,0,0]},{direction:-1,ordinal:-1,counts:[1,0,0]}]) expect(()=>resolvePierceBranch(hits,branch as never)).toThrow(/Invalid/);
});
it('does not confuse extreme positive rational weights with coplanar geometry',()=>{
  const curve:PierceCurve={type:'segment',start:[-10,-5],segment:{type:'conic',end:[10,5],control:[2,0],rho:1-1e-12}};
  const hits=pierceCurvePlane(curve,xy,xz);expect(hits).toHaveLength(1);expect(hits[0].parameter).toBe(.5);close(hits[0].worldPoint,[2,0,0]);
});

it('keeps physically distinct contacts very close to a curve endpoint',()=>{
  const e=1e-10,curve:PierceCurve={type:'segment',start:[0,0],segment:{type:'bezier',controls:[[1e6/3,e/6],[2e6/3,-1/6]],end:[1e6,.5-e/2]}};
  const hits=pierceCurvePlane(curve,xy,xz);expect(hits).toHaveLength(3);
  close(hits.map(h=>h.worldPoint[0]),[0,.0001,500000]);expect(hits.map(h=>h.direction)).toEqual([-1,1,-1]);
});
