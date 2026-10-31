import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';

/** Shape Binder (FreeCAD's PartDesign ShapeBinder / SubShapeBinder): a live copy of an
 *  earlier part, or of picked faces of it, as a new part. The copy is rebuilt from the
 *  source on every replay, so edits to the source flow into every feature built on the
 *  binder; the binder itself never changes its source. */
export interface ShapeBinderFeature {
  id:string;type:'shape-binder';name:string;suppressed:boolean;
  sourceBodyId:string;
  /** Picked faces to bind as a sheet; absent binds the whole solid. */
  faces?:SolidFaceReference[];
  operation:'new';bodyId?:string;
}
export function validateShapeBinder(feature:ShapeBinderFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  if(typeof feature.sourceBodyId!=='string'||!feature.sourceBodyId.trim())throw Error('Shape binder needs a source part.');
  if(feature.faces!==undefined){
    if(!Array.isArray(feature.faces)||!feature.faces.length||feature.faces.length>64)throw Error('Bind one to 64 faces, or leave faces out to bind the whole part.');
    for(const face of feature.faces){validateSolidFaceReference(face,earlier,missing,'Shape binder face');if(face.bodyId!==feature.sourceBodyId)throw Error('Shape binder faces must belong to the source part.');}
  }
  if(feature.operation!=='new')throw Error('A shape binder is always a new part.');
}
