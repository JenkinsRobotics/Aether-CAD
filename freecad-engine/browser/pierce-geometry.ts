/** Exact finite sketch-curve / plane contacts for Pierce. No display mesh or
 * flattened projection determines the intersection. Constraint integration is
 * separate; these contacts are derived, never authored sketch geometry. */
import { validateSketchDrawing, type SketchFrame, type SketchPoint, type SketchSegment } from '../../aether-engine/src/sketch/drawing';
import { sketchFrameMap } from '../../aether-engine/src/sketch/projection/frame-map';
import { ellipseFrame, ellipsePoint, segmentPoint, type EllipseFrame } from '../../aether-engine/src/sketch/curves/parameterization';
import { sketchArcGeometry } from '../../aether-engine/src/sketch/arc-geometry';
import { PierceReferenceError } from './pierce-reference-error';

export type PierceCurve = { type: 'circle'; center: SketchPoint; radius: number } |
  { type: 'segment'; start: SketchPoint; segment: SketchSegment };
export type PierceDirection = -1 | 0 | 1;
export interface PierceHit {
  parameter: number;
  point: SketchPoint;
  worldPoint: [number, number, number];
  direction: PierceDirection;
}
export interface PierceBranch {
  direction: PierceDirection;
  ordinal: number;
  /** Negative crossings, tangencies, positive crossings. A changed signature
   * requires reselecting a contact, rather than silently choosing another. */
  counts: [number, number, number];
}
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const value = (coefficients: readonly number[], t: number) => coefficients.reduceRight((sum, n) => sum*t+n, 0);
const unique = (values: number[]) => values.sort((a,b)=>a-b).filter((t,i,list)=>i===0 || Math.abs(t-list[i-1])>8*Number.EPSILON);

/** Degree <=3 distance numerator. Extrema partition monotonic intervals; an
 * already accepted boundary root is never bisected again on rounding noise. */
function distanceRoots(coefficients:number[]):number[] {
  const scale=Math.max(...coefficients.map(Math.abs)), c=coefficients.map(v=>v/scale);
  while(c.length>1&&c.at(-1)===0)c.pop();
  if(c.length===1)return [];
  if(c.length===2) {const t=-c[0]/c[1];return t>=-1e-12&&t<=1+1e-12?[Math.max(0,Math.min(1,t))]:[];}
  const critical=distanceRoots(c.slice(1).map((v,i)=>v*(i+1))),bounds=unique([0,...critical,1]);
  const zero=(t:number)=>Math.abs(value(c,t))<=Number.EPSILON*16*c.reduce((sum,v,i)=>sum+Math.abs(v*t**i),0);
  const roots=bounds.filter(zero);
  for(let i=1;i<bounds.length;i++) {
    let a=bounds[i-1],b=bounds[i],fa=value(c,a);
    if(zero(a)||zero(b)||fa*value(c,b)>=0)continue;
    for(let iteration=0;iteration<60;iteration++) {const middle=(a+b)/2,fm=value(c,middle);if(fa*fm<=0)b=middle;else{a=middle;fa=fm;}}
    roots.push((a+b)/2);
  }
  return unique(roots);
}

function polynomialDirection(coefficients: number[], t: number): PierceDirection {
  let derivative = coefficients;
  for (let order = 1; order < coefficients.length; order++) {
    derivative = derivative.slice(1).map((v,i)=>v*(i+1));
    const slope = value(derivative,t);
    if (Math.abs(slope)>Number.EPSILON*128*derivative.reduce((sum,v,i)=>sum+Math.abs(v*t**i),0)) return order%2 ? slope>0 ? 1 : -1 : 0;
  }
  return 0;
}

/** Curve parameters always increase from the authored start to end. Full
 * circles use one turn from their positive local X axis, with a single seam. */
export function pierceCurvePlane(curve: PierceCurve, source: SketchFrame, target: SketchFrame): PierceHit[] {
  const map = sketchFrameMap(source,target); // Validates both orthonormal frames.
  validateSketchDrawing({type:'drawing',contours:[curve.type==='circle' ? curve : {type:'path',start:curve.start,segments:[curve.segment]}]});
  const y = cross(source.normal,source.xDirection), delta = source.originMillimeters.map((v,i)=>v-target.originMillimeters[i]);
  const a=dot(source.xDirection,target.normal), b=dot(y,target.normal), c=dot(delta,target.normal);
  const depth=(p:SketchPoint)=>a*p[0]+b*p[1]+c;
  const world=(p:SketchPoint):[number,number,number]=>source.originMillimeters.map((v,i)=>v+source.xDirection[i]*p[0]+y[i]*p[1]) as [number,number,number];
  let coefficients:number[]|undefined, frame:EllipseFrame|undefined, poleDepths:number[]=[];
  if(curve.type==='circle') frame={center:curve.center,radiusX:curve.radius,radiusY:curve.radius,rotation:0,startAngle:0,sweep:2*Math.PI};
  else {
    const s=curve.segment, d0=depth(curve.start), d1=depth(s.end);
    if(s.type==='line') {coefficients=[d0,d1-d0];poleDepths=[d0,d1];}
    else if(s.type==='bezier') {
      const u=depth(s.controls[0]),v=depth(s.controls[1]);
      coefficients=[d0,3*(u-d0),3*(v-2*u+d0),d1-3*v+3*u-d0];
      poleDepths=[d0,u,v,d1];
    } else if(s.type==='conic') {
      const r=s.rho,w=1-r,u=depth(s.control);
      coefficients=[w*d0,2*(r*u-w*d0),w*(d0+d1)-2*r*u];
      poleDepths=[d0,u,d1];
    } else if(s.type==='ellipse') frame=ellipseFrame(curve.start,s);
    else { const arc=sketchArcGeometry(curve.start,s.middle,s.end);frame={...arc,radiusX:arc.radius,radiusY:arc.radius,rotation:0}; }
  }
  const at=(t:number)=>curve.type==='circle' ? ellipsePoint(frame!,t) : segmentPoint(curve.start,curve.segment,t);
  let parameters:number[],direction:(t:number)=>PierceDirection;
  if(coefficients) {
    if(poleDepths.every(depth=>Math.abs(depth)<1e-10)) throw new PierceReferenceError('The selected curve lies in the sketch plane; Pierce needs an isolated intersection.');
    parameters=distanceRoots(coefficients);
    direction=t=>polynomialDirection(coefficients!,t);
  } else {
    const f=frame!, cos=Math.cos(f.rotation),sin=Math.sin(f.rotation);
    const x=f.radiusX*(a*cos+b*sin),y=f.radiusY*(-a*sin+b*cos),offset=depth(f.center),radius=Math.hypot(x,y);
    if(radius<1e-12) {
      if(Math.abs(offset)<1e-10) throw new PierceReferenceError('The selected curve lies in the sketch plane; Pierce needs an isolated intersection.');
      return [];
    }
    const ratio=-offset/radius;
    if(ratio < -1-1e-12 || ratio > 1+1e-12) return [];
    const phase=Math.atan2(y,x),angle=Math.acos(Math.max(-1,Math.min(1,ratio)));
    const low=Math.min(f.startAngle,f.startAngle+f.sweep),high=Math.max(f.startAngle,f.startAngle+f.sweep);
    parameters=[];
    for(const base of [phase-angle,phase+angle]) for(let turn=Math.ceil((low-base-1e-10)/(2*Math.PI));turn<=Math.floor((high-base+1e-10)/(2*Math.PI));turn++) {
      const t=(base+turn*2*Math.PI-f.startAngle)/f.sweep;
      if(t>=-1e-9&&t<=1+1e-9)parameters.push(Math.max(0,Math.min(1,t)));
    }
    direction=t=>{const angle=f.startAngle+t*f.sweep,slope=(-x*Math.sin(angle)+y*Math.cos(angle))*f.sweep;
      return Math.abs(slope)<radius*Math.abs(f.sweep)*1e-9 ? 0 : slope>0 ? 1 : -1;};
  }
  parameters=unique(parameters);
  if(curve.type==='circle' && parameters.length>1 && parameters[0]<1e-13 && parameters.at(-1)!>1-1e-13 && Math.hypot(...at(parameters[0]).map((v,i)=>v-at(parameters.at(-1)!)[i]))<1e-7) parameters.pop();
  return parameters.map(parameter=>{
    const p=at(parameter);
    if(Math.abs(depth(p))>1e-7) throw Error('The curve-plane contact could not be resolved accurately.');
    return {parameter,point:map.point(p),worldPoint:world(p),direction:direction(parameter)};
  });
}

function branchCounts(hits: readonly PierceHit[]): [number,number,number] {
  return [-1,0,1].map(direction=>hits.filter(hit=>hit.direction===direction).length) as [number,number,number];
}
export function pierceBranch(hits:readonly PierceHit[],index:number):PierceBranch {
  if(!Number.isInteger(index)||index<0||!hits[index]) throw Error('Select an existing curve-plane intersection.');
  const hit=hits[index];
  return {direction:hit.direction,ordinal:hits.slice(0,index).filter(h=>h.direction===hit.direction).length,counts:branchCounts(hits)};
}
export function resolvePierceBranch(hits:readonly PierceHit[],branch:PierceBranch):PierceHit {
  if(!branch || ![-1,0,1].includes(branch.direction) || !Number.isInteger(branch.ordinal) || branch.ordinal<0 ||
    !Array.isArray(branch.counts)||branch.counts.length!==3||branch.counts.some(n=>!Number.isInteger(n)||n<0)||
    branch.ordinal>=branch.counts[branch.direction+1]) throw Error('Invalid Pierce intersection reference. Reselect the source curve.');
  if(branchCounts(hits).some((n,i)=>n!==branch.counts[i])) throw new PierceReferenceError('The Pierce intersection disappeared or changed branches. Reselect its source intersection.');
  const hit=hits.filter(h=>h.direction===branch.direction)[branch.ordinal];
  if(!hit) throw new PierceReferenceError('The Pierce intersection is unavailable.');
  return hit;
}
