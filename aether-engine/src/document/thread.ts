import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';
import {isHoleThreadStandard,threadClasses,threadSpecification,type HoleThreadStandard} from './hole-standards';

/** Cosmetic Thread (SolidCraft's solid.thread, modeled: false): a thread
 *  designation recorded on a cylindrical face. The model is unchanged; the
 *  tree and part inspection list it. A modelled thread is not provided yet. */
export interface ThreadFeature {
  id:string;type:'thread';name:string;suppressed:boolean;
  face:SolidFaceReference;
  /** ISO metric designation, e.g. "M8" or "M8x1"; with `standard`, a size of that table ("1/4-20", "G1/2"). */
  designation:string;
  /** The Hole thread table the designation comes from; absent means free-form ISO metric. */
  standard?:HoleThreadStandard;
  /** Tolerance class ("6H", "6g" is external: use "6H"/"6G"/"2B" as the hole tables list). */
  threadClass?:string;
  lengthMillimeters?:number;
  modeled?:false;
  /** Onshape's size from the cylinder: the designation is the standard's size whose major diameter is nearest the picked face's, re-read when the face changes. */
  sizeFromFace?:boolean;
  /** Onshape's Add chamfer: a chamfer on the circular edge where the thread starts (distance along the cylinder, angle from it). */
  chamfer?:{distanceMillimeters:number;angleDegrees:number};
  /** Onshape's Add undercut: a groove at the thread's end, to this diameter over this length. */
  undercut?:{diameterMillimeters:number;lengthMillimeters:number};
  /** Onshape's Split face: the cylindrical face is split where the thread ends. */
  splitFace?:boolean;
  /** The part carrying the face (the window sets it from the pick). */
  targetBodyId?:string;
}
export function validateThread(feature:ThreadFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  validateSolidFaceReference(feature.face,earlier,missing,'Thread face');
  if(feature.face.surfaceType!=='cylinder')throw Error('A thread goes on a cylindrical face.');
  if(feature.standard!==undefined){
    if(!isHoleThreadStandard(feature.standard))throw Error('Unknown thread standard.');
    if(typeof feature.designation!=='string'||!threadSpecification(feature.standard,feature.designation))throw Error(`Unknown ${feature.standard} thread size "${feature.designation}".`);
  } else if(typeof feature.designation!=='string'||!/^M\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?$/i.test(feature.designation.trim()))throw Error('Thread designation must be ISO metric, like M8 or M8x1.');
  if(feature.threadClass!==undefined&&!threadClasses(feature.standard??'iso-metric-coarse').includes(feature.threadClass))throw Error('Unknown thread class for this standard.');
  if(feature.lengthMillimeters!==undefined&&!(Number.isFinite(feature.lengthMillimeters)&&feature.lengthMillimeters>0))throw Error('Thread length must be positive.');
  const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  if(feature.chamfer!==undefined&&(!positive(feature.chamfer.distanceMillimeters)||!(positive(feature.chamfer.angleDegrees)&&feature.chamfer.angleDegrees<90)))throw Error('A thread chamfer needs a positive distance and an angle below 90 degrees.');
  if(feature.undercut!==undefined&&(!positive(feature.undercut.diameterMillimeters)||!positive(feature.undercut.lengthMillimeters)))throw Error('A thread undercut needs a positive diameter and length.');
  if((feature.undercut||feature.splitFace)&&feature.lengthMillimeters===undefined)throw Error('An undercut or split face needs a Blind thread length.');
  if(feature.sizeFromFace!==undefined&&typeof feature.sizeFromFace!=='boolean')throw Error('sizeFromFace must be true or false.');
  if(feature.sizeFromFace&&feature.standard===undefined)throw Error('Size from the face needs a thread standard.');
  if(feature.modeled)throw Error('Modelled threads are not provided yet; the thread is cosmetic.');
}
