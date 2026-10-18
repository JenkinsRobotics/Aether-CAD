import type {SketchDrawing} from '../../aether-engine/src/sketch/drawing';
import type {DrawingConstraint,SketchEntityRef} from '../../aether-engine/src/sketch/solver/types';
import {referencedContour} from '../../aether-engine/src/sketch/solver/projected-context';
import {resolveSegmentReference} from '../../aether-engine/src/sketch/solver/segment-reference';
import {dimensionValue} from '../../aether-engine/src/sketch/solver/dimension-links';
import {validateConic,type ConicSegment} from './conic-geometry';

export function referencedConic(drawing:SketchDrawing,ref:SketchEntityRef):ConicSegment {
  const contour=referencedContour(drawing,ref),r=resolveSegmentReference(contour,ref);
  if(contour?.type!=='path'||r.kind!=='curve'||!Number.isInteger(r.index)) throw Error('Select a conic curve.');
  const segment=contour.segments[r.index!];
  if(segment?.type!=='conic') throw Error('Select a conic curve.');
  validateConic(r.index===0?contour.start:contour.segments[r.index!-1].end,segment);
  return segment;
}

export function conicRhoResiduals(drawing:SketchDrawing,c:DrawingConstraint):number[] {
  if(c.b||c.axis||c.point||c.fixedGeometry) throw Error('Rho dimensions reference one conic curve.');
  const rho=dimensionValue(drawing,c);
  if(!Number.isFinite(rho)||rho<=0||rho>=1) throw Error('Conic rho must be greater than 0 and less than 1.');
  return [referencedConic(drawing,c.a).rho-rho];
}

/** The existing iteration engine consumes adapter-owned coordinates. Log odds
 * keep a free rho inside its finite positive-weight domain during a solve. */
export function conicCoordinates(s:ConicSegment) {
  return [
    ...([0,1] as const).map(i=>({get:()=>s.control[i],set:(value:number)=>{s.control[i]=value;}})),
    {get:()=>Math.log(s.rho/(1-s.rho)),set:(value:number)=>{
      const e=Math.exp(-Math.abs(value));
      s.rho=Math.max(Number.MIN_VALUE,Math.min(1-Number.EPSILON,value>=0?1/(1+e):e/(1+e)));
    }},
  ];
}
