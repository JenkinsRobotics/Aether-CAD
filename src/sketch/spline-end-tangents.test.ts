import { describe, expect, it } from 'vitest';
import {
  fitSketchSpline, constrainFitSpline, dragSketchEntity, addSketchSplineHandle,
  solveDrawingConstraints, sketchConstraintState, constraintResiduals, copySketchContours,
  type SketchDrawing, type SketchPoint,
} from '@aether/core/sketch';
import { enableSplineEndTangent, splineEndTangentShape, validateSplineFreeEnds } from '../../freecad-engine/browser/spline-end-tangents';
import { fixedEntityConstraint } from '../../freecad-engine/browser/fixed-geometry';
import { createEmptyPartDocument, serializePartDocument, parsePartDocument } from '@aether/core/document';
import { insertFitSplinePoint } from '../../aether-engine/src/sketch/operations/insert-fit-spline-point';
import { segmentPoint } from '../../aether-engine/src/sketch/curves/parameterization';

const points: SketchPoint[] = [[0,0],[10,12],[23,7],[30,0]];
const source = () => constrainFitSpline({type:'drawing',contours:[fitSketchSpline(points)]},0);
const ref = (end: 'start'|'end') => ({kind:'point' as const,contour:0,index:end === 'start' ? 0 : 2,control:end === 'start' ? 0 as const : 1 as const});
const pathOf = (drawing: SketchDrawing) => {
  const path = drawing.contours[0];
  if (path.type !== 'path' || path.segments.some(s=>s.type!=='bezier')) throw Error('Expected spline');
  return path;
};
const expectKnots = (drawing: SketchDrawing) => {
  const p = pathOf(drawing);
  [p.start,...p.segments.map(s=>s.end)].forEach((actual,i)=>actual.forEach((v,k)=>expect(v).toBeCloseTo(points[i][k],6)));
};
const maxResidual = (d: SketchDrawing) => Math.max(0,...(d.constraints ?? []).flatMap(c=>constraintResiduals(d,c)).map(Math.abs));

describe('independent fit-spline endpoint tangents',()=>{
  it.each(['start','end'] as const)('drags %s tangent while holding every fit point and preserving the opposite natural end',end=>{
    const d=source(), before=structuredClone(d), old=pathOf(d), selection=ref(end), delta:SketchPoint=[2,3];
    const moved=dragSketchEntity(d,selection,delta), p=pathOf(moved), s=p.segments[selection.index], original=old.segments[selection.index];
    if(s.type!=='bezier'||original.type!=='bezier')throw Error();
    s.controls[selection.control].forEach((v,k)=>expect(v).toBeCloseTo(original.controls[selection.control][k]+delta[k],6));
    expectKnots(moved); expect(d).toEqual(before);
    expect(moved.constraints).toHaveLength(1);
    expect(moved.constraints![0].splineFreeEnds).toEqual([end]);
    expect(maxResidual(moved)).toBeLessThan(1e-6);
    const opposite=end==='start'?p.segments.at(-1)!:p.segments[0];
    if(opposite.type!=='bezier')throw Error();
    const a=end==='start'?p.segments.at(-2)!.end:p.start, b=opposite.end;
    for(const axis of [0,1]) {
      const second=end==='start'?b[axis]-2*opposite.controls[1][axis]+opposite.controls[0][axis]:a[axis]-2*opposite.controls[0][axis]+opposite.controls[1][axis];
      expect(second).toBeCloseTo(0,6);
    }
    expect(sketchConstraintState(moved)).toMatchObject({degreesOfFreedom:10,redundantEquations:0});
  });
  it('clamps both end controls and independently verifies C1/C2 at the fit knots',()=>{
    let d=dragSketchEntity(source(),ref('start'),[0,4]);
    const held=structuredClone(pathOf(d).segments[0]);
    d=dragSketchEntity(d,ref('end'),[-2,3]);
    expectKnots(d);expect(d.constraints![0].splineFreeEnds).toEqual(['start','end']);
    const p=pathOf(d), h=points.slice(1).map((q,i)=>Math.hypot(q[0]-points[i][0],q[1]-points[i][1]));
    if(held.type!=='bezier'||p.segments[0].type!=='bezier')throw Error();
    p.segments[0].controls[0].forEach((v,i)=>expect(v).toBeCloseTo(held.controls[0][i],6));
    for(let i=0;i<p.segments.length-1;i++) {
      const a=p.segments[i],b=p.segments[i+1];if(a.type!=='bezier'||b.type!=='bezier')throw Error();
      for(const k of [0,1]) {
        expect((a.end[k]-a.controls[1][k])/h[i]).toBeCloseTo((b.controls[0][k]-a.end[k])/h[i+1],6);
        expect((a.end[k]-2*a.controls[1][k]+a.controls[0][k])/(h[i]*h[i])).toBeCloseTo((a.end[k]-2*b.controls[0][k]+b.controls[1][k])/(h[i+1]*h[i+1]),6);
      }
    }
    expect(sketchConstraintState(d)).toMatchObject({degreesOfFreedom:12,redundantEquations:0});
    expect(constrainFitSpline(d,0)).toEqual(d);
  });
  it('uses ordinary handle length/angle dimensions with fixed fit points',()=>{
    const selected=addSketchSplineHandle(source(),{kind:'curve',contour:0,index:0},'start'), d=selected.drawing;
    d.constraints!.push(...points.map((point,index)=>({id:`knot-${index}`,kind:'fix' as const,a:{kind:'point' as const,contour:0,index},point:[...point] as SketchPoint})));
    d.contours.push({type:'path',construction:true,start:[0,-5],segments:[{type:'line',end:[10,-5]}]});
    d.constraints!.push(fixedEntityConstraint(d,{kind:'line',contour:2,index:0}));
    d.constraints!.push({id:'length',kind:'length',a:selected.handle,value:7},{id:'angle',kind:'angle',a:{kind:'line',contour:2,index:0},b:selected.handle,value:35});
    const solved=solveDrawingConstraints(d), line=solved.contours[1];if(line.type!=='path')throw Error();
    expectKnots(solved);expect(Math.hypot(line.segments[0].end[0]-line.start[0],line.segments[0].end[1]-line.start[1])).toBeCloseTo(7,6);
    expect(maxResidual(solved)).toBeLessThan(1e-6);
    expect(sketchConstraintState(solved)).toMatchObject({degreesOfFreedom:0,redundantEquations:0});
    const before=structuredClone(solved);
    expect(()=>dragSketchEntity(solved,ref('start'),[1,2])).toThrow(/conflict|converge/);
    expect(solved).toEqual(before);
  });
  it('whole-curve Fix locks free tangents without false redundant equations',()=>{
    const d=dragSketchEntity(source(),ref('start'),[0,3]);
    d.constraints!.push(fixedEntityConstraint(d,{kind:'curve',contour:0,index:0,parameter:0}));
    expect(sketchConstraintState(d)).toMatchObject({state:'fully-constrained',degreesOfFreedom:0,redundantEquations:0});
    expect(()=>dragSketchEntity(d,ref('start'),[2,1])).toThrow();
  });
  it('preserves the clamped curve and free ends when inserting a fit knot',()=>{
    const d=dragSketchEntity(source(),ref('start'),[0,3]), p=pathOf(d), s=p.segments[0];
    const point=segmentPoint(p.start,s,0.4);
    const inserted=insertFitSplinePoint(d,0,0,0.4,point,1e-6)!;
    expect(inserted.constraints![0].splineFreeEnds).toEqual(['start']);
    expect(maxResidual(inserted)).toBeLessThan(1e-6);
    expect(pathOf(inserted).segments).toHaveLength(4);
    const moved=dragSketchEntity(inserted,ref('start'),[1,2]);
    expect(maxResidual(moved)).toBeLessThan(1e-6);
    expect(pathOf(moved).segments[0].end[0]).toBeCloseTo(point[0],6);
    expect(pathOf(moved).segments[0].end[1]).toBeCloseTo(point[1],6);
  });
  it.each([
    {a:0,b:-2,c:2,d:0,tx:40,ty:10},
    {a:-1,b:0,c:0,d:1,tx:50,ty:5},
  ])('retains independent tangent meaning in transformed copies',transform=>{
    const d=dragSketchEntity(source(),ref('start'),[0,3]);
    const copied=copySketchContours(d,[0],[transform]);
    expect(copied.contours).toHaveLength(2);
    expect(copied.constraints).toHaveLength(2);
    expect(copied.constraints![1].splineFreeEnds).toEqual(['start']);
    expect(maxResidual(copied)).toBeLessThan(1e-6);
    expect(copied.contours[0]).toEqual(d.contours[0]);
  });
  it('handles the two-point cubic with both independent endpoints',()=>{
    const d=constrainFitSpline({type:'drawing',contours:[fitSketchSpline([[0,0],[10,0]])]},0);
    const first=dragSketchEntity(d,{kind:'point',contour:0,index:0,control:0},[0,5]);
    const moved=dragSketchEntity(first,{kind:'point',contour:0,index:0,control:1},[0,-4]);
    expect(maxResidual(moved)).toBeLessThan(1e-6);
    expect(sketchConstraintState(moved)).toMatchObject({degreesOfFreedom:8,redundantEquations:0});
  });
  it('roundtrips free ends and edited controls through the Part reader',()=>{
    const d=dragSketchEntity(source(),ref('end'),[2,2]),doc=createEmptyPartDocument('End tangents');
    doc.features.push({id:'spline',type:'profile',name:'Sketch 1',suppressed:false,plane:'XY',offsetMillimeters:0,profile:d});
    const reopened=parsePartDocument(serializePartDocument(doc));
    expect(reopened.features[0]).toEqual(doc.features[0]);
  });
  it('keeps periodic splines on their existing periodic relation',()=>{
    const d=constrainFitSpline({type:'drawing',contours:[fitSketchSpline(points,{closed:true})]},0);
    expect(enableSplineEndTangent(d,ref('start'))).toBe(d);
    expect(()=>splineEndTangentShape(d.contours[0],undefined,['start'])).toThrow(/open/);
  });
  it.each([[],['middle'],['start','start'],['start','end','start'],true])('rejects malformed endpoint flags %j',ends=>{
    const c={...source().constraints![0],splineFreeEnds:ends} as any;
    expect(()=>validateSplineFreeEnds(c)).toThrow();
  });
  it('rejects endpoint flags on an unrelated constraint',()=>{
    expect(()=>validateSplineFreeEnds({id:'bad',kind:'fix',a:ref('start'),point:[0,0],splineFreeEnds:['start']})).toThrow();
  });
});
