import { validatePartDocument, type PartDocument } from '../../aether-engine/src/document/part-document';
import { resolveProfileDrawing } from '../../aether-engine/src/document/profile-projection';
import { solveDrawingConstraints } from '../../aether-engine/src/sketch/solver/solve';
import type { SketchEntityRef } from '../../aether-engine/src/sketch/solver/types';
import { referenceSketchPierce } from './pierce-reference';
import { withPierceContext } from './pierce-context';
import { solveProjectedConstraints } from '../../aether-engine/src/document/projected-constraints';
import { preparePierceDraft } from './pierce-draft';
import { pierceTargetReference } from './pierce-constraints';

/** Editor transaction, including repair of one of several broken references.
 * Unresolved relations remain explicit and prevent Finish; no partial document
 * is committed by this helper. The strict saved operation below stays separate. */
export function stageSketchPierce(document:PartDocument,targetId:string,a:SketchEntityRef,sourceId:string,contourIndex:number,segmentIndex:number|undefined,contactIndex:number,replaceId?:string) {
 const chosen=referenceSketchPierce(document,targetId,sourceId,contourIndex,segmentIndex,contactIndex);
 const next=chosen.document,feature=next.features.find(f=>f.id===targetId);
 if(feature?.type!=='profile')throw Error('Pierce needs an editable sketch.');
 const authored=feature.profile.type==='drawing'?feature.profile:feature.profile.type==='projection'?feature.profile.authored:undefined;
 if(!authored)throw Error('Select an authored target point or curve.');
 const old=replaceId?authored.constraints?.find(c=>c.id===replaceId):undefined;
 if(replaceId&&old?.kind!=='pierce')throw Error('That Pierce constraint no longer exists.');
 let n=1;while(authored.constraints?.some(c=>c.id===`pierce-${n}`))n++;
 const constraint={id:replaceId??`pierce-${n}`,kind:'pierce' as const,a:pierceTargetReference(authored,a,chosen.hit.point),source:chosen.reference};
 const targetKey=(ref:SketchEntityRef)=>JSON.stringify([ref.contour,ref.kind,ref.segmentId??ref.index,ref.vertexId,ref.control,ref.controlScale??1]);
 const sourceKey=(ref:typeof constraint.source|undefined)=>ref&&JSON.stringify([ref.kind,ref.sourceFeatureId,ref.sourceContourId,ref.sourceSegmentId,ref.branch.direction,ref.branch.ordinal,ref.branch.counts]);
 if(!replaceId&&authored.constraints?.some(c=>c.kind==='pierce'&&targetKey(c.a)===targetKey(constraint.a)&&sourceKey(c.source)===sourceKey(constraint.source)))return {document,added:false,issues:[]};
 authored.constraints=replaceId?authored.constraints!.map(c=>c.id===replaceId?constraint:c):[...authored.constraints??[],constraint];
 const background=feature.profile.type==='projection'?resolveProfileDrawing(next.features.map(f=>f.id===targetId?{...feature,profile:{...feature.profile,authored:undefined}}:f),targetId):undefined;
 const prepared=preparePierceDraft(next.features,targetId,background?{...authored,projectionContext:background.contours}:authored);
 const saved=structuredClone(prepared.drawing);delete saved.pierceContext;delete saved.projectionContext;
 if(feature.profile.type==='drawing')feature.profile=saved;else if(feature.profile.type==='projection')feature.profile.authored=saved;
 return {document:next,added:true,issues:prepared.issues};
}

/** Source IDs and the canonical relationship are committed as one candidate.
 * The caller's ordinary document transaction supplies undo/cancel/history. */
export function addSketchPierce(document:PartDocument,targetId:string,a:SketchEntityRef,sourceId:string,contourIndex:number,segmentIndex:number|undefined,contactIndex:number):PartDocument {
  const chosen=referenceSketchPierce(document,targetId,sourceId,contourIndex,segmentIndex,contactIndex);
  const next=chosen.document,feature=next.features.find(f=>f.id===targetId);
  if(feature?.type!=='profile'||!['drawing','projection'].includes(feature.profile.type))throw Error('Pierce needs an editable sketch.');
  const authored=feature.profile.type==='drawing'?feature.profile:feature.profile.type==='projection'?feature.profile.authored:undefined;
  if(!authored)throw Error('Select an authored target point or curve.');
  let id=1;while(authored.constraints?.some(c=>c.id===`pierce-${id}`))id++;
  authored.constraints=[...authored.constraints??[],{id:`pierce-${id}`,kind:'pierce',a:structuredClone(a),source:chosen.reference}];
  const prepared=withPierceContext(next.features,targetId,authored);
  const result=feature.profile.type==='projection'?solveProjectedConstraints(prepared,resolveProfileDrawing(next.features.map(f=>f.id===targetId?{...feature,profile:{...feature.profile,authored:undefined}}:f),targetId)):solveDrawingConstraints(prepared);
  delete result.pierceContext;delete result.projectionContext;
  if(feature.profile.type==='drawing')feature.profile=result;
  else if(feature.profile.type==='projection')feature.profile.authored=result;
  validatePartDocument(next);return next;
}
