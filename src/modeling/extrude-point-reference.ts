import {profileSketchFrame,resolveProfileDrawing,rollbackPosition,type ExtrusionPointReference,type PartDocument} from '@aether/core/document';
import type {SketchPoint} from '@aether/core/sketch';

/** Resolve current constrained coordinates; only stable identities are saved. */
export function extrusionSketchPoints(doc:PartDocument,beforeFeatureId?:string) {
  const end=beforeFeatureId?doc.features.findIndex(f=>f.id===beforeFeatureId):rollbackPosition(doc);
  return doc.features.slice(0,Math.max(0,end)).flatMap(feature=>{
    // Projected points need native support/projection association before they
    // can safely serve a limit after upstream face motion.
    if(feature.type!=='profile'||feature.suppressed||feature.profile.type==='projection')return [];
    try {
      return resolveProfileDrawing(doc.features,feature.id).contours.flatMap((contour,contourIndex)=>{
        const base={sourceFeatureId:feature.id,contourId:contour.id,contourIndex,frame:profileSketchFrame(feature),support:feature.support};
        const points:{point:'center'|'vertex';vertexId?:string;index:number;position:SketchPoint;label:string}[]=[];
        if(contour.type==='circle') points.push({point:'center',index:0,position:contour.center,label:`${feature.name} · Circle ${contourIndex+1} center`});
        else {
          points.push({point:'vertex',vertexId:contour.startVertexId,index:0,position:contour.start,label:`${feature.name} · Point ${contourIndex+1}.1`});
          contour.segments.forEach((segment,index)=>{
            if((segment.endVertexId&&points.some(p=>p.vertexId===segment.endVertexId))||(index===contour.segments.length-1&&Math.hypot(segment.end[0]-contour.start[0],segment.end[1]-contour.start[1])<1e-7))return;
            points.push({point:'vertex',vertexId:segment.endVertexId,index:index+1,position:segment.end,label:`${feature.name} · Point ${contourIndex+1}.${index+2}`});
          });
        }
        return points.map(point=>({...base,...point}));
      });
    } catch {return [];}
  });
}
export function nativeExtrusionPoint(doc:PartDocument,ref:ExtrusionPointReference,beforeFeatureId:string) {
  if(ref.kind==='solid-vertex')return ref;
  const matches=extrusionSketchPoints(doc,beforeFeatureId).filter(p=>p.sourceFeatureId===ref.sourceFeatureId&&p.contourId===ref.contourId&&p.point===ref.point&&(p.point==='center'||p.vertexId===ref.vertexId));
  if(matches.length!==1)throw Error('Stopping sketch point is unavailable. Reselect a point in an earlier sketch.');
  const point=matches[0];
  return {kind:'sketch-point',local_point:point.position,frame:point.frame,...(point.support?{support:point.support}:{})};
}
