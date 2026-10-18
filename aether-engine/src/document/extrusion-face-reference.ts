import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';
export {curvedSurfaceTypes,type CurvedSurfaceType,type CurvedSurfaceAnchor} from './solid-face-reference';
export type ExtrusionFaceReference=SolidFaceReference;
export function validateExtrusionFaceReference(ref:ExtrusionFaceReference|undefined,
  earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  validateSolidFaceReference(ref,earlier,missing,'Up to face');
}
