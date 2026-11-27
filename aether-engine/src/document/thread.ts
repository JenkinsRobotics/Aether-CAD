import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';
import {isHoleThreadStandard,threadClasses,threadSpecification,type HoleThreadStandard} from './hole-standards';

export type ThreadForm = "v60" | "trapezoidal" | "acme" | "buttress";

/** Cosmetic or Modelled Thread (SolidCraft's `solid.thread`): records a thread designation on
 *  a cylindrical face, with optional physical chamfer, undercut, face split, or full helical
 *  modelled thread (V60, trapezoidal, ACME, buttress; right/left hand; 1..8 starts). */
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
  /** When true, cuts an exact helical thread groove into the cylinder. */
  modeled?:boolean;
  /** Left-hand helix direction when modeled (default false = right-hand). */
  leftHand?:boolean;
  /** Multi-start thread count (1..8, default 1). */
  starts?:number;
  /** Thread tooth profile form (default "v60"). */
  form?:ThreadForm;
  /** Override pitch in mm (otherwise taken from standard/designation). */
  pitchMillimeters?:number;
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

const ISO_COARSE_PITCH: Record<number, number> = {
  2: 0.4, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5,
  12: 1.75, 14: 2.0, 16: 2.0, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3.0, 27: 3.0, 30: 3.5,
};

/** Resolve pitch (mm) and nominal major diameter (mm) for a ThreadFeature. */
export function resolveThreadGeometry(feature: ThreadFeature): { majorDiameterMillimeters: number; pitchMillimeters: number } {
  if (feature.standard) {
    const spec = threadSpecification(feature.standard, feature.designation);
    if (spec) {
      return {
        majorDiameterMillimeters: spec.majorDiameterMillimeters,
        pitchMillimeters: feature.pitchMillimeters ?? spec.pitchMillimeters,
      };
    }
  }
  const match = /^M(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/i.exec(feature.designation.trim());
  const major = match ? Number(match[1]) : 8;
  const pitch = feature.pitchMillimeters ?? (match?.[2] ? Number(match[2]) : (ISO_COARSE_PITCH[major] ?? Math.max(0.4, major * 0.15)));
  return { majorDiameterMillimeters: major, pitchMillimeters: pitch };
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
  if(feature.modeled!==undefined&&typeof feature.modeled!=='boolean')throw Error('modeled must be true or false.');
  if(feature.leftHand!==undefined&&typeof feature.leftHand!=='boolean')throw Error('leftHand must be true or false.');
  if(feature.starts!==undefined&&(!Number.isInteger(feature.starts)||feature.starts<1||feature.starts>8))throw Error('Thread starts must be an integer from 1 to 8.');
  if(feature.form!==undefined&&!["v60","trapezoidal","acme","buttress"].includes(feature.form))throw Error('Unknown thread form.');
  if(feature.pitchMillimeters!==undefined&&!positive(feature.pitchMillimeters))throw Error('Thread pitch must be positive.');
}
