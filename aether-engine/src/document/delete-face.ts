import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';

/** Delete Face (SolidCraft's face.delete with heal): the faces go and the
 *  neighbouring surfaces extend to close the gap (OCCT defeaturing). */
export interface DeleteFaceFeature {
  id:string;type:'delete-face';name:string;suppressed:boolean;
  targetBodyId:string;
  faces:SolidFaceReference[];
}
export function validateDeleteFace(feature:DeleteFaceFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  if(typeof feature.targetBodyId!=='string')throw Error('Delete face needs a target part.');
  if(!Array.isArray(feature.faces)||!feature.faces.length)throw Error('Pick at least one face to delete.');
  for(const face of feature.faces){validateSolidFaceReference(face,earlier,missing,'Face to delete');if(face.bodyId!==feature.targetBodyId)throw Error('Faces to delete must lie on the target part.');}
}
