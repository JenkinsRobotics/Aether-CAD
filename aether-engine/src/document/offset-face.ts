import {validateTransform,type PartTransform} from './part-transform';
import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';
export type FaceTransform=Extract<PartTransform,{kind:'translate'|'translate-reference'|'rotate'|'rotate-reference'}>;
export interface OffsetFaceFeature {
  id:string; type:'offset-face'; name:string; suppressed:boolean;
  faces:SolidFaceReference[];
  distanceMillimeters?:number;
  transform?:FaceTransform;
}
export function offsetFaceBodies(feature:OffsetFaceFeature):string[] {
  return [...new Set(feature.faces.map(face=>face.bodyId))];
}
export function validateOffsetFace(feature:OffsetFaceFeature,earlier:Map<string,string>,missing:(id:unknown)=>boolean) {
  if(!Array.isArray(feature.faces)||!feature.faces.length||feature.faces.length>256)throw Error('Choose one or more faces to offset (up to 256).');
  if(feature.transform!==undefined){
    if(feature.distanceMillimeters!==undefined||!['translate','translate-reference','rotate','rotate-reference'].includes(feature.transform?.kind))throw Error('Choose an offset distance or a face Translate/Rotate operation.');
    validateTransform({id:feature.id,type:'transform',name:feature.name,suppressed:feature.suppressed,bodyIds:offsetFaceBodies(feature),transform:feature.transform},earlier,missing);
  }else if(typeof feature.distanceMillimeters!=='number'||!Number.isFinite(feature.distanceMillimeters)||Math.abs(feature.distanceMillimeters)<1e-6)throw Error('Offset distance must be finite and nonzero.');
  if('targetBodyId' in feature||'targetBodyIds' in feature)throw Error('Offset target parts are determined by the selected faces.');
  const identities=new Set<string>();
  for(const face of feature.faces){
    validateSolidFaceReference(face,earlier,missing,'Offset faces');
    const id=JSON.stringify([face.sourceFeatureId,face.bodyId,face.normal,face.surfaceType,face.faceAnchor?.centerMillimeters,face.faceAnchor?.areaSquareMillimeters]);
    if(identities.has(id))throw Error('Select each offset face only once.');
    identities.add(id);
  }
}
