/** Exact transient native checks generated from the saved source/target refs. */
import type { PartFeature } from '../../aether-engine/src/document/part-document';
import type { ProfileFeature } from '../../aether-engine/src/document/solid-features';
import { profileSketchFrame,resolveProfileDrawing } from '../../aether-engine/src/document/profile-projection';
import type { SketchDrawing } from '../../aether-engine/src/sketch/drawing';
import { resolveSegmentReference } from '../../aether-engine/src/sketch/solver/segment-reference';
import { sketchEntityPoint } from '../../aether-engine/src/sketch/solver/entities';
import { resolveSketchPierce } from './pierce-reference';
import { nativeWireSegments } from './wire-geometry';
import type { FreeCADFeature } from '../../src/freecad-geometry';

export function nativePierceChecks(features:readonly PartFeature[],feature:ProfileFeature,resolved:SketchDrawing) {
  const authored=feature.profile.type==='drawing'?feature.profile:feature.profile.type==='projection'?feature.profile.authored:undefined;
  const sources:FreeCADFeature[]=[],checks=new Map<number,Record<string,unknown>[]>(),targets=new Map<number,FreeCADFeature>();
  if(!authored)return {sources,checks,targets};
  const offset=feature.profile.type==='projection'?resolved.contours.length-authored.contours.length:0;
  for(const c of authored.constraints??[]) {
    if(c.kind!=='pierce')continue;
    const source=c.source!, hit=resolveSketchPierce(features,feature.id,source);
    const sourceFeature=features.find(f=>f.id===source.sourceFeatureId) as ProfileFeature;
    const sourceContour=resolveProfileDrawing(features,sourceFeature.id).contours.find(q=>q.id===source.sourceContourId)!;
    const id=`${feature.id}#pierce-source#${c.id}`,frame=profileSketchFrame(sourceFeature);
    const placement={frame,...(sourceFeature.support?{support:sourceFeature.support,source_profile_id:sourceFeature.id}:{})};
    if(sourceContour.type==='circle')sources.push({id,kind:'sketch-circle',parameters:{center_mm:sourceContour.center,radius_mm:sourceContour.radius,...placement}});
    else {
      const index=sourceContour.segments.findIndex(s=>s.id===source.sourceSegmentId),start=index?sourceContour.segments[index-1].end:sourceContour.start;
      sources.push({id,kind:'sketch-wire',parameters:{start_mm:start,segments:nativeWireSegments(start,[sourceContour.segments[index]]),...placement}});
    }
    const contourIndex=c.a.contour+offset,contour=resolved.contours[contourIndex];
    const a=resolveSegmentReference(contour,{...c.a,contour:contourIndex});
    let target:Record<string,unknown>;
    if(a.kind!=='point')target={kind:'curve',geometry:contour.type==='circle'?0:a.index};
    else if(contour.type==='circle')target={kind:'center',geometry:0};
    else if(a.control!==undefined)target={kind:'control',geometry:a.index,control:a.control,scale:a.controlScale??1};
    else {
      // Arc parameter order can reverse in FreeCAD. Match the canonical point
      // against the actual native edge endpoints, never trust EdgeN endpoint 1/2.
      target={kind:'endpoint',geometry:a.index===0?0:a.index!-1,local_point:sketchEntityPoint(resolved,a)};
    }
    const entries=checks.get(contourIndex)??[];
    entries.push({id:c.id,source_sketch:id,world_point:hit.worldPoint,target});checks.set(contourIndex,entries);
    const targetPlacement={frame:profileSketchFrame(feature),pierce_checks:entries,source_profile_id:feature.id,...(feature.support?{support:feature.support}:{})};
    const targetId=`${feature.id}#pierce-target#${contourIndex}`;
    targets.set(contourIndex,contour.type==='circle'?{id:targetId,kind:'sketch-circle',parameters:{center_mm:contour.center,radius_mm:contour.radius,...targetPlacement}}:
      contour.segments.length?{id:targetId,kind:'sketch-wire',parameters:{start_mm:contour.start,segments:nativeWireSegments(contour.start,contour.segments),...targetPlacement}}:
        {id:targetId,kind:'sketch-point',parameters:{point_mm:contour.start,...targetPlacement}});
  }
  return {sources,checks,targets};
}
