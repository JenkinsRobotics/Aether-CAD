/** Direct manipulation of the existing exact, authored full-ellipse contract.
 * Handles are projections; the two analytic half-arcs remain the only geometry. */
import { validateSketchDrawing, type SketchDrawing, type SketchPoint } from '../../aether-engine/src/sketch/drawing';
import { ellipseShapeResiduals } from '../../aether-engine/src/sketch/solver/ellipse-shape';
import { solveDrawingConstraints } from '../../aether-engine/src/sketch/solver/solve';
import type { SketchEntityRef } from '../../aether-engine/src/sketch/solver/types';

export type EllipseHandleKind = 'center' | 'primary' | 'secondary' | 'rotation';
export interface EllipseHandle {
  contour: number;
  kind: EllipseHandleKind;
  side: 1 | -1;
  point: SketchPoint;
  ref: SketchEntityRef;
  label: string;
}

export function fullSketchEllipse(drawing: SketchDrawing, contour: number) {
  const path = drawing.contours[contour];
  if (path?.type !== 'path' || path.segments.length !== 2 || path.segments.some(s=>s.type!=='ellipse') ||
    !drawing.constraints?.some(c => c.kind === 'ellipse-shape' && !c.reference && c.a.contour === contour)) return;
  try { if (ellipseShapeResiduals(path).some(r => Math.abs(r) > 1e-6)) return; }
  catch { return; }
  const arc = path.segments[0];
  if (arc.type !== 'ellipse') return;
  return { center: [(path.start[0]+arc.end[0])/2, (path.start[1]+arc.end[1])/2] as SketchPoint,
    radiusX: arc.radiusX, radiusY: arc.radiusY, rotation: arc.rotationDegrees*Math.PI/180 };
}

/** Primary/secondary retain creation order even when their relative sizes swap. */
export function ellipseHandles(drawing: SketchDrawing, rotationOffset: number): EllipseHandle[] {
  const handles: EllipseHandle[] = [];
  drawing.contours.forEach((_, contour) => {
    const shape = fullSketchEllipse(drawing, contour); if (!shape) return;
    const {center, radiusX: rx, radiusY: ry, rotation} = shape, cos=Math.cos(rotation), sin=Math.sin(rotation);
    const at=(x:number,y:number):SketchPoint=>[center[0]+x*cos-y*sin,center[1]+x*sin+y*cos];
    const ellipse:SketchEntityRef={contour,kind:'ellipse',index:0};
    let centerRef=ellipse;
    for(const c of drawing.constraints ?? []) {
      if(c.kind!=='concentric' || c.reference) continue;
      const other=c.a.kind==='ellipse' && c.a.contour===contour ? c.b : c.b?.kind==='ellipse' && c.b.contour===contour ? c.a : undefined;
      if(other?.kind==='point' && other.projectedContourId===undefined) {centerRef=other;break;}
    }
    handles.push({contour,kind:'center',side:1,point:[...center],ref:centerRef,label:'Ellipse center'});
    for(const side of [1,-1] as const) {
      handles.push({contour,kind:'primary',side,point:at(side*rx,0),ref:{contour,kind:'point',index:side===1?0:1},label:'Resize ellipse primary axis'});
      handles.push({contour,kind:'secondary',side,point:at(0,side*ry),ref:ellipse,label:'Resize ellipse secondary axis'});
    }
    handles.push({contour,kind:'rotation',side:1,point:at(rx+Math.max(rotationOffset,rx*.15),0),ref:ellipse,label:'Rotate ellipse'});
  });
  return handles;
}

/** One pointer target holds this ellipse, then solves its existing relationships.
 * The solver's fixed-contour option is transient; nothing is added to the file. */
export function dragSketchEllipse(source:SketchDrawing, handle:Pick<EllipseHandle,'contour'|'kind'|'side'>, start:SketchPoint, pointer:SketchPoint):SketchDrawing {
  if(![...start,...pointer].every(Number.isFinite)) throw Error('Ellipse pointer coordinates must be finite.');
  const shape=fullSketchEllipse(source,handle.contour);
  if(!shape) throw Error('Select an authored full ellipse.');
  const center:SketchPoint=[...shape.center];let rx=shape.radiusX,ry=shape.radiusY,angle=shape.rotation;
  const dx=pointer[0]-start[0],dy=pointer[1]-start[1];
  if(handle.kind==='center') {center[0]+=dx;center[1]+=dy;}
  else if(handle.kind==='primary') rx+=handle.side*(dx*Math.cos(angle)+dy*Math.sin(angle));
  else if(handle.kind==='secondary') ry+=handle.side*(-dx*Math.sin(angle)+dy*Math.cos(angle));
  else {
    const a:[number,number]=[start[0]-center[0],start[1]-center[1]],b:[number,number]=[pointer[0]-center[0],pointer[1]-center[1]];
    if(Math.hypot(...a)<1e-6 || Math.hypot(...b)<1e-6) throw Error('Move the rotation handle away from the ellipse center.');
    angle+=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
  }
  if(rx<=1e-6 || ry<=1e-6) throw Error('Ellipse radii must remain positive.');
  const next=structuredClone(source),path=next.contours[handle.contour];
  if(path.type!=='path') throw Error('Select an ellipse.');
  path.start=[center[0]+rx*Math.cos(angle),center[1]+rx*Math.sin(angle)];
  path.segments.forEach((s,i)=>{
    if(s.type!=='ellipse') throw Error('Ellipse topology changed.');
    s.radiusX=rx;s.radiusY=ry;s.rotationDegrees=angle*180/Math.PI;
    s.end=i===0?[center[0]-rx*Math.cos(angle),center[1]-rx*Math.sin(angle)]:[...path.start];
  });
  validateSketchDrawing(next);
  try {
    const solved=solveDrawingConstraints(next,{fixedContours:new Set([handle.contour])});
    if(JSON.stringify(solved.contours[handle.contour])!==JSON.stringify(path)) throw Error('The ellipse did not retain the pointer target.');
    validateSketchDrawing(solved);return solved;
  } catch(error) {
    throw Error(`Existing constraints prevent this ellipse edit. Adjust its dimensions or constraints. ${(error as Error).message}`);
  }
}
