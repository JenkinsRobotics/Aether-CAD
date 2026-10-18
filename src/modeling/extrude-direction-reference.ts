import { profileSketchFrame, resolveProfileDrawing, rollbackPosition, type PartDocument, type SketchLineDirectionReference } from '@aether/core/document';
import type { SketchPoint } from '@aether/core/sketch';

/** Product reference projection; coordinates are recomputed, never saved in the link. */
export function sketchDirectionLines(doc:PartDocument, beforeFeatureId?:string) {
  const end=beforeFeatureId?doc.features.findIndex(f=>f.id===beforeFeatureId):rollbackPosition(doc);
  return doc.features.slice(0,Math.max(0,end)).flatMap(feature=>{
    if(feature.type!=='profile'||feature.suppressed||feature.profile.type==='projection')return [];
    try {
      const drawing=resolveProfileDrawing(doc.features,feature.id);
      return drawing.contours.flatMap((contour,contourIndex)=>{
        if(contour.type!=='path')return [];
        let start:SketchPoint=contour.start;
        return contour.segments.flatMap((segment,segmentIndex)=>{
          const a=start;start=segment.end;
          if(segment.type!=='line'||Math.hypot(segment.end[0]-a[0],segment.end[1]-a[1])<1e-9)return [];
          return [{sourceFeatureId:feature.id,contourIndex,segmentIndex,contourId:contour.id,segmentId:segment.id,
            label:`${feature.name} · ${contour.construction?'Construction line':'Line'} ${contourIndex+1}.${segmentIndex+1}`,
            start:a,end:segment.end,frame:profileSketchFrame(feature),support:feature.support}];
        });
      });
    } catch { return []; }
  });
}
export function resolveSketchDirection(doc:PartDocument, ref:SketchLineDirectionReference, beforeFeatureId?:string) {
  const matches=sketchDirectionLines(doc,beforeFeatureId).filter(line=>line.sourceFeatureId===ref.sourceFeatureId&&line.contourId===ref.contourId&&line.segmentId===ref.segmentId);
  if(matches.length!==1)throw Error('Extrusion direction line is unavailable or no longer straight. Reselect a line in an earlier sketch.');
  return matches[0];
}
export function directionLineVector(line:ReturnType<typeof sketchDirectionLines>[number]):[number,number,number] {
  const x=line.frame.xDirection,n=line.frame.normal,y=[n[1]*x[2]-n[2]*x[1],n[2]*x[0]-n[0]*x[2],n[0]*x[1]-n[1]*x[0]];
  const dx=line.end[0]-line.start[0],dy=line.end[1]-line.start[1];
  const vector=x.map((v,i)=>v*dx+y[i]*dy),length=Math.hypot(...vector);
  return vector.map(v=>v/length) as [number,number,number];
}
export function nativeSketchDirection(doc:PartDocument, ref:SketchLineDirectionReference, beforeFeatureId:string) {
  const line=resolveSketchDirection(doc,ref,beforeFeatureId);
  return {kind:'sketch-line',local_vector:[line.end[0]-line.start[0],line.end[1]-line.start[1]],frame:line.frame,...(line.support?{support:line.support}:{})};
}
