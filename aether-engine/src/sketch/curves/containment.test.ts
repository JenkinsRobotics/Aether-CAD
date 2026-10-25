import { expect, it } from 'vitest';
import { type SketchContour, type SketchPoint, type SketchSegment } from '../drawing';
import { classifySketchContourPoint as classify } from './containment';
import { segmentPoint } from './parameterization';
import { curveJet } from './derivatives';

const circle: SketchContour = {type:'circle', center:[0,0], radius:10};
const disk: SketchContour = {type:'path', start:[10,0], segments:[
  {type:'arc', middle:[0,10], end:[-10,0]}, {type:'arc',middle:[0,-10],end:[10,0]},
]};

it('classifies inside/outside and boundary independently of circle display chords', () => {
  for (const contour of [circle, disk]) for (let i=0;i<96;i++) {
    const angle=(i+.5)*Math.PI/48;
    const at=(r:number):SketchPoint=>[r*Math.cos(angle),r*Math.sin(angle)];
    expect(classify(contour,at(9.9999))).toBe('inside');
    expect(classify(contour,at(10.0001))).toBe('outside');
    expect(classify(contour,at(10))).toBe('boundary');
  }
});

it('handles rays through joined vertices and tangencies without double counting', () => {
  for (const p of [[0,0],[0,9],[0,-9]] as SketchPoint[]) expect(classify(disk,p)).toBe('inside');
  for (const p of [[-20,0],[-20,10],[-20,-10],[20,0]] as SketchPoint[]) expect(classify(disk,p)).toBe('outside');
  expect(classify(disk,[10,0])).toBe('boundary');
  const reverse:SketchContour={type:'path',start:[10,0],segments:[{type:'arc',middle:[0,-10],end:[-10,0]},{type:'arc',middle:[0,10],end:[10,0]}]};
  expect(classify(reverse,[0,0])).toBe('inside');
  expect(classify(reverse,[-20,10])).toBe('outside');
});

it.each<SketchSegment>([
  {type:'bezier',controls:[[10,8],[-10,8]],end:[-10,0]},
  {type:'ellipse',radiusX:10,radiusY:4,rotationDegrees:0,largeArc:false,sweep:true,end:[-10,0]},
  {type:'conic',control:[0,12],rho:.35,end:[-10,0]},
  {type:'conic',control:[0,12],rho:.5,end:[-10,0]},
  {type:'conic',control:[0,12],rho:.8,end:[-10,0]},
])('picks on both sides of an exact $type edge near a display chord', segment => {
  const start:SketchPoint=[10,0], contour:SketchContour={type:'path',start,segments:[segment,{type:'line',end:start}]};
  const jet=curveJet({start,segment});
  for (const t of [.013,.127,.311,.537,.827,.981]) {
    const {point,first}=jet(t),length=Math.hypot(...first),normal=[-first[1]/length,first[0]/length];
    expect(classify(contour,[point[0]+normal[0]*.0001,point[1]+normal[1]*.0001])).toBe('inside');
    expect(classify(contour,[point[0]-normal[0]*.0001,point[1]-normal[1]*.0001])).toBe('outside');
    expect(classify(contour,segmentPoint(start,segment,t))).toBe('boundary');
  }
});

it('does not classify an open or construction path as a face', () => {
  expect(classify({...circle,construction:true},[0,0])).toBe('outside');
  expect(classify({type:'path',start:[0,0],segments:[{type:'line',end:[5,0]}]},[2,0])).toBe('outside');
  expect(classify(circle,[NaN,0])).toBe('ambiguous');
});
