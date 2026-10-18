import type { SketchPoint } from '../../aether-engine/src/sketch/drawing';
import type { Curve, CurveIntersection } from '../../aether-engine/src/sketch/curves/pairs';
import { polynomialRoots } from '../../aether-engine/src/sketch/curves/intersections';
import { segmentPoint, ellipseFrame } from '../../aether-engine/src/sketch/curves/parameterization';
import { sketchArcGeometry } from '../../aether-engine/src/sketch/arc-geometry';
import { conicPoint, validateConic, type ConicSegment } from './conic-geometry';

type Polynomial = number[];
const add = (a: Polynomial, b: Polynomial, scale = 1) => Array.from({length: Math.max(a.length,b.length)}, (_,i)=>(a[i]??0)+scale*(b[i]??0));
const mul = (a: Polynomial,b:Polynomial) => { const out=Array(a.length+b.length-1).fill(0) as number[]; a.forEach((x,i)=>b.forEach((y,j)=>out[i+j]+=x*y)); return out; };
const scaled = (p:Polynomial,k:number)=>p.map(v=>v*k);

/** Numerators/denominator in Bernstein's equivalent power basis. Coordinates
 * are relative to the implicit conic origin for translation stability. */
function rational(curve: Curve, origin: SketchPoint): {x:Polynomial;y:Polynomial;d:Polynomial} {
  const s=curve.segment, p:SketchPoint=[curve.start[0]-origin[0],curve.start[1]-origin[1]], q:SketchPoint=[s.end[0]-origin[0],s.end[1]-origin[1]];
  if(s.type==='line') return {x:[p[0],q[0]-p[0]],y:[p[1],q[1]-p[1]],d:[1]};
  if(s.type==='bezier') {
    const f=(i:0|1)=>{const a=s.controls[0][i]-origin[i],b=s.controls[1][i]-origin[i];return [p[i],3*(a-p[i]),3*(b-2*a+p[i]),q[i]-3*b+3*a-p[i]];};
    return {x:f(0),y:f(1),d:[1]};
  }
  if(s.type!=='conic') throw Error('Expected a polynomial or rational quadratic curve.');
  const r=s.rho,v=1-r,f=(i:0|1)=>{const a=s.control[i]-origin[i];return [v*p[i],2*(r*a-v*p[i]),v*(p[i]+q[i])-2*r*a];};
  return {x:f(0),y:f(1),d:[v,2*(2*r-1),2*(1-2*r)]};
}

/** Recover the finite positive-weight arc parameter from barycentric position. */
export function conicParameterAtPoint(start:SketchPoint,s:ConicSegment,p:SketchPoint):number|undefined {
  validateConic(start,s);
  const a=[s.control[0]-start[0],s.control[1]-start[1]],b=[s.end[0]-start[0],s.end[1]-start[1]],q=[p[0]-start[0],p[1]-start[1]],det=a[0]*b[1]-a[1]*b[0],
    l1=(q[0]*b[1]-q[1]*b[0])/det,l2=(a[0]*q[1]-a[1]*q[0])/det,l0=1-l1-l2;
  if(Math.min(l0,l1,l2)<-1e-8) return;
  const a0=Math.sqrt(Math.max(0,l0)),a2=Math.sqrt(Math.max(0,l2));
  if(a0+a2<1e-14) return;
  const t=a2/(a0+a2),actual=conicPoint(start,s,t),scale=Math.max(1,Math.hypot(...a),Math.hypot(...b));
  if(Math.hypot(actual[0]-p[0],actual[1]-p[1])>1e-7*scale) return;
  return t;
}

function polynomialPair(first: Curve & {segment:ConicSegment}, second:Curve):CurveIntersection[] {
  const s=first.segment,origin=first.start,ax=s.control[0]-origin[0],ay=s.control[1]-origin[1],bx=s.end[0]-origin[0],by=s.end[1]-origin[1],det=ax*by-ay*bx,
    r=rational(second,origin),l1=scaled(add(scaled(r.x,by),scaled(r.y,-bx)),1/det),l2=scaled(add(scaled(r.y,ax),scaled(r.x,-ay)),1/det),l0=add(add(r.d,l1,-1),l2,-1),
    aa=scaled(mul(l1,l1),(1-s.rho)**2),bb=scaled(mul(l0,l2),4*s.rho*s.rho),p=add(aa,bb,-1),scale=Math.max(...aa.map(Math.abs),...bb.map(Math.abs),1e-30);
  // Identical underlying conics can overlap over a bounded interval. Its
  // boundaries occur at either curve's endpoints; retain their exact params.
  const coincident=p.every(v=>Math.abs(v)<scale*1e-11),
    ts=coincident?[0,1,...polynomialRoots(l0),...polynomialRoots(l2)]:polynomialRoots(p.map(v=>v/scale));
  return ts.flatMap(t=>{const point=segmentPoint(second.start,second.segment,t),u=conicParameterAtPoint(origin,s,point);return u===undefined?[]:[{first:u,second:t,point}];});
}

/** Finite conic intersections reduce to degree2/4/6 polynomial roots, including
 * tangencies. Ellipse/circle arcs are partitioned into exact rational quadratics
 * solely for root finding; their authored representation is left untouched. */
export function conicCurveIntersections(first:Curve,second:Curve):CurveIntersection[] {
  if(first.segment.type!=='conic') {
    if(second.segment.type!=='conic') throw Error('Conic intersection needs a conic.');
    return conicCurveIntersections(second,first).map(h=>({first:h.second,second:h.first,point:h.point}));
  }
  validateConic(first.start,first.segment);
  const a={...first,segment:first.segment}, s=second.segment;
  let hits:CurveIntersection[];
  if(s.type==='line'||s.type==='bezier'||s.type==='conic') hits=polynomialPair(a,second);
  else {
    const f=s.type==='ellipse'?ellipseFrame(second.start,s):(()=>{const c=sketchArcGeometry(second.start,s.middle,s.end);return {...c,radiusX:c.radius,radiusY:c.radius,rotation:0};})(),
      count=Math.ceil(Math.abs(f.sweep)/(Math.PI/2)),c=Math.cos(f.rotation),n=Math.sin(f.rotation),
      at=(angle:number,scale=1):SketchPoint=>{const x=f.radiusX*Math.cos(angle)*scale,y=f.radiusY*Math.sin(angle)*scale;return [f.center[0]+c*x-n*y,f.center[1]+n*x+c*y];};
    hits=[];
    for(let i=0;i<count;i++) {
      const begin=f.startAngle+f.sweep*i/count,delta=f.sweep/count,w=Math.cos(delta/2),
        part:Curve={start:at(begin),segment:{type:'conic',end:at(begin+delta),control:at(begin+delta/2,1/w),rho:w/(1+w)}};
      for(const h of polynomialPair(a,part)) {
        const x=h.point[0]-f.center[0],y=h.point[1]-f.center[1],angle=Math.atan2((-n*x+c*y)/f.radiusY,(c*x+n*y)/f.radiusX),
          shift=Math.atan2(Math.sin(angle-begin),Math.cos(angle-begin));
        hits.push({...h,second:Math.max(0,Math.min(1,(i+shift/delta)/count))});
      }
    }
  }
  return hits.sort((a,b)=>a.first-b.first).filter((h,i,all)=>!all.slice(0,i).some(p=>Math.abs(p.first-h.first)<1e-7&&Math.abs(p.second-h.second)<1e-7));
}

/** Parameters on an infinite line against a finite conic. */
export function lineConicIntersections(a:SketchPoint,b:SketchPoint,start:SketchPoint,s:ConicSegment):number[] {
  validateConic(start,s);
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  if(length<1e-20) throw Error('Intersection line has zero length.');
  const values=[start,s.control,s.end].map(p=>(p[0]-a[0])*dy-(p[1]-a[1])*dx),v=1-s.rho,r=s.rho;
  return polynomialRoots([v*values[0],2*(r*values[1]-v*values[0]),v*(values[0]+values[2])-2*r*values[1]]).map(t=>{
    const p=conicPoint(start,s,t);return ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length;
  });
}
