/** Preserve the actual external contact when a circle becomes finite arcs.
 * This is a reference projection over exact topology edits, not a new curve or
 * a second stored point. Ordinary constraints and solving remain canonical. */
import type { SketchDrawing } from '../../aether-engine/src/sketch/drawing';
import { closestSegmentParameter } from '../../aether-engine/src/sketch/curves/parameterization';
import { identifySegmentReference } from '../../aether-engine/src/sketch/solver/segment-reference';
import { pierceContextPoint } from './pierce-context';

export function remapCirclePierceTargets(source:SketchDrawing,next:SketchDrawing,index:number,operation:'split'|'trim'):void {
  const original=source.contours[index],path=next.contours[index];
  if(original.type!=='circle'||path?.type!=='path')throw Error('Pierce circle remapping requires the original circle and its exact retained arcs.');
  const replacements=new Map<string,NonNullable<SketchDrawing['constraints']>[number]|undefined>();
  for(const constraint of source.constraints??[]) {
    if(constraint.kind!=='pierce'||constraint.a.contour!==index||constraint.a.kind!=='circle')continue;
    const point=pierceContextPoint(source,constraint);
    let found=false;
    for(const [segmentIndex,segment] of path.segments.entries()) {
      const start=segmentIndex?path.segments[segmentIndex-1].end:path.start;
      const hit=closestSegmentParameter(start,segment,point);
      if(hit.distance>1e-7)continue;
      const a=identifySegmentReference(path,{kind:'curve',contour:index,index:segmentIndex,parameter:hit.parameter,sliding:true});
      replacements.set(constraint.id,{...constraint,a});found=true;break;
    }
    if(!found) {
      if(operation==='split')throw Error('The split did not retain the Pierce contact. No geometry was changed.');
      replacements.set(constraint.id,undefined);
    }
  }
  next.constraints=next.constraints?.flatMap(c=>replacements.has(c.id)?(replacements.get(c.id)?[replacements.get(c.id)!]:[]):[c]);
  for(const [id,replacement] of replacements)if(!replacement&&next.pierceContext)delete next.pierceContext[id];
}
