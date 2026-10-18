/** Actual finite source curves crossing the active sketch plane. Projected
 * background geometry must never substitute for these exact intersections. */
import type { PartFeature } from '../../aether-engine/src/document/part-document';
import { profileSketchFrame,resolveProfileDrawing } from '../../aether-engine/src/document/profile-projection';
import { pierceCurvePlane,type PierceHit } from './pierce-geometry';
export interface PierceChoice {
 key:string;sourceId:string;sourceName:string;contourIndex:number;segmentIndex?:number;
 contourId?:string;segmentId?:string;curveType:string;hits:PierceHit[];
}
export function sketchPierceChoices(features:readonly PartFeature[],targetId:string):PierceChoice[] {
 const index=features.findIndex(f=>f.id===targetId),target=features[index];
 if(target?.type!=='profile')return [];
 const frame=profileSketchFrame(target),choices:PierceChoice[]=[];
 for(const feature of features.slice(0,index)) {
  if(feature.type!=='profile'||feature.suppressed)continue;
  try {
   const drawing=resolveProfileDrawing(features,feature.id),sourceFrame=profileSketchFrame(feature);
   for(const [contourIndex,c] of drawing.contours.entries()) {
    const curves=c.type==='circle'?[{curve:c,index:undefined}]:c.segments.map((segment,i)=>({curve:{type:'segment' as const,start:i?c.segments[i-1].end:c.start,segment},index:i}));
    for(const item of curves) {
     try {
      const hits=pierceCurvePlane(item.curve,sourceFrame,frame);if(!hits.length)continue;
      choices.push({key:JSON.stringify([feature.id,contourIndex,item.index]),sourceId:feature.id,sourceName:feature.name,contourIndex,segmentIndex:item.index,
       contourId:c.id,segmentId:c.type==='path'?c.segments[item.index!].id:undefined,curveType:c.type==='circle'?'circle':c.segments[item.index!].type,hits});
     }catch{/* Coplanar, missing, or non-finite intersections cannot be picked. */}
    }
   }
  }catch{/* Unavailable upstream geometry stays unavailable; never use its cache. */}
 }
 return choices;
}
