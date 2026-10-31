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
  if(feature.modeled)throw Error('Modelled threads are not provided yet; the thread is cosmetic.');
}
