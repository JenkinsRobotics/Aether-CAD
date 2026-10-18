import {validatePlanarFaceAnchor,type PlanarFaceAnchor} from './planar-face-anchor';

/** A start plane is resolved again on rebuild; no cached origin or FaceN. */
export type ExtrusionStartReference =
 | {kind:'face';sourceFeatureId:string;bodyId:string;normal:[number,number,number];label:string;faceAnchor?:PlanarFaceAnchor}
 | {kind:'plane';sourceFeatureId:string;label:string}
 | {kind:'principal';plane:'XY'|'XZ'|'YZ';label:string};

export function validateExtrusionStartReference(ref:ExtrusionStartReference,earlier:Map<string,string>,missing:(id:string)=>boolean):void {
 const fail=()=>{throw Error('Starting entity needs an earlier parallel face or reference plane.');};
 if(!ref||!['face','plane','principal'].includes(ref.kind)||typeof ref.label!=='string'||!ref.label.trim()||ref.label.length>512)return fail();
 if(ref.kind==='principal'){if(!['XY','XZ','YZ'].includes(ref.plane))fail();return;}
 if(typeof ref.sourceFeatureId!=='string'||!ref.sourceFeatureId.trim()||ref.sourceFeatureId.length>128)return fail();
 const type=earlier.get(ref.sourceFeatureId);
 if(!missing(ref.sourceFeatureId)&&(!type||(ref.kind==='plane'?type!=='plane':['profile','sketch','plane'].includes(type))))return fail();
 if(ref.kind==='face'){
  validatePlanarFaceAnchor(ref.faceAnchor);
  if(typeof ref.bodyId!=='string'||!ref.bodyId.trim()||ref.bodyId.length>256||!Array.isArray(ref.normal)||ref.normal.length!==3||!ref.normal.every(Number.isFinite)||Math.abs(Math.hypot(...ref.normal)-1)>1e-6)fail();
 }
}
