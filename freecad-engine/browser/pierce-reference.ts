/** Stable source and intersection branch for canonical Pierce relationships.
 * Authoring stages these references with source identities in one transaction. */
import type { PartDocument, PartFeature } from '../../aether-engine/src/document/part-document';
import { referenceProfileContour } from '../../aether-engine/src/document/profile-contour-reference';
import { profileSketchFrame, resolveProfileDrawing } from '../../aether-engine/src/document/profile-projection';
import { pierceBranch, pierceCurvePlane, resolvePierceBranch, type PierceBranch, type PierceCurve } from './pierce-geometry';
import type { SketchDrawing } from '../../aether-engine/src/sketch/drawing';
import { PierceReferenceError } from './pierce-reference-error';

export interface SketchPierceReference {
  kind: 'sketch-curve';
  sourceFeatureId: string;
  sourceContourId: string;
  sourceSegmentId?: string;
  branch: PierceBranch;
}

export function sketchPierceContacts(features: readonly PartFeature[], targetFeatureId: string, source: Omit<SketchPierceReference,'branch'>, resolveDrawing: (id:string)=>SketchDrawing = id=>resolveProfileDrawing(features,id)) {
  if(!source || source.kind!=='sketch-curve' || typeof source.sourceFeatureId!=='string' || typeof source.sourceContourId!=='string' || !source.sourceContourId.trim()) throw Error('Invalid Pierce source reference.');
  const targetIndex=features.findIndex(f=>f.id===targetFeatureId), sourceIndex=features.findIndex(f=>f.id===source.sourceFeatureId);
  const target=features[targetIndex], feature=features[sourceIndex];
  if(target?.type!=='profile' || sourceIndex<0 || sourceIndex>=targetIndex || feature.type!=='profile') throw Error('Pierce must reference an earlier source sketch.');
  if(features.filter(f=>f.id===source.sourceFeatureId).length!==1 || features.filter(f=>f.id===targetFeatureId).length!==1) throw Error('Invalid Pierce source reference.');
  if(feature.suppressed) throw Error(`Pierce source is suppressed: ${feature.name}.`);
  const contours=resolveDrawing(feature.id).contours.filter(c=>c.id===source.sourceContourId);
  if(contours.length!==1) throw new PierceReferenceError('The Pierce source contour is missing or ambiguous. Reselect it.');
  const contour=contours[0];let curve:PierceCurve;
  if(contour.type==='circle') {
    if(source.sourceSegmentId!==undefined) throw new PierceReferenceError('The Pierce source curve changed type. Reselect it.');
    curve=contour;
  } else {
    if(!source.sourceSegmentId?.trim()) throw new PierceReferenceError('The Pierce source curve changed type. Reselect an identified source segment.');
    const indices=contour.segments.flatMap((s,i)=>s.id===source.sourceSegmentId?[i]:[]);
    if(indices.length!==1) throw new PierceReferenceError('The Pierce source segment is missing or ambiguous. Reselect it.');
    const index=indices[0];curve={type:'segment',start:index?contour.segments[index-1].end:contour.start,segment:contour.segments[index]};
  }
  return pierceCurvePlane(curve,profileSketchFrame(feature),profileSketchFrame(target));
}

export function resolveSketchPierce(features: readonly PartFeature[], targetFeatureId: string, reference: SketchPierceReference, resolveDrawing?: (id:string)=>SketchDrawing) {
  return resolvePierceBranch(sketchPierceContacts(features,targetFeatureId,reference,resolveDrawing),reference.branch);
}

/** Identity and reference are returned together for an eventual atomic commit.
 * Choosing a different contact requires an explicit new reference. */
export function referenceSketchPierce(source: PartDocument, targetFeatureId: string, sourceFeatureId: string, contourIndex: number, segmentIndex: number|undefined, contactIndex: number, createId?:()=>string) {
  const selected=referenceProfileContour(source,sourceFeatureId,contourIndex,createId);
  const contour=resolveProfileDrawing(selected.document.features,sourceFeatureId).contours[contourIndex];
  if(!contour?.id) throw Error('The Pierce source needs a stable contour identity.');
  if(contour.type==='path'&&(!Number.isInteger(segmentIndex)||!contour.segments[segmentIndex!]?.id)) throw Error('Select a Pierce source segment.');
  if(contour.type==='circle'&&segmentIndex!==undefined) throw Error('A circle Pierce source does not have a segment.');
  const ref:Omit<SketchPierceReference,'branch'>={kind:'sketch-curve',sourceFeatureId,sourceContourId:contour.id,
    ...(contour.type==='path'?{sourceSegmentId:contour.segments[segmentIndex!].id}:{} )};
  const hits=sketchPierceContacts(selected.document.features,targetFeatureId,ref);
  return {document:selected.document,reference:{...ref,branch:pierceBranch(hits,contactIndex)} satisfies SketchPierceReference,hit:hits[contactIndex]};
}
