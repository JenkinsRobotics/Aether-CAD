import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';

/** Plastic features (SolidCraft's plastic.boss / plastic.rest): raised on a picked
 *  planar face at a point, out of the face. A boss is a round post, optionally
 *  drafted and bored; a rest is a round or rectangular pad. */
interface OnFace {
  targetBodyId:string;
  face:SolidFaceReference;
  pointMillimeters:[number,number,number];
  /** Draft of the walls; default: none. */
  draftDegrees?:number;
}
export interface BossFeature extends OnFace {
  id:string;type:'boss';name:string;suppressed:boolean;
  diameterMillimeters:number;heightMillimeters:number;
  holeDiameterMillimeters?:number;holeDepthMillimeters?:number;
}
export interface RestFeature extends OnFace {
  id:string;type:'rest';name:string;suppressed:boolean;
  /** Round: the diameter. Rectangular (with a length): the width. */
  widthMillimeters:number;lengthMillimeters?:number;heightMillimeters:number;
  /** A rectangle's length direction (in the face); default: the face's x direction. */
  alongMillimeters?:[number,number,number];
}
const pos=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function validateOnFace(feature:OnFace,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean,what:string) {
  if(typeof feature.targetBodyId!=='string')throw Error(`${what} needs a target part.`);
  validateSolidFaceReference(feature.face,earlier,missing,`${what} face`);
  if(feature.face.surfaceType)throw Error(`${what} goes on a planar face.`);
  if(!Array.isArray(feature.pointMillimeters)||feature.pointMillimeters.length!==3||!feature.pointMillimeters.every(Number.isFinite))throw Error(`${what} needs a point on the face.`);
  if(feature.draftDegrees!==undefined&&!(Number.isFinite(feature.draftDegrees)&&feature.draftDegrees>=0&&feature.draftDegrees<45))throw Error(`${what} draft must be between 0 and 45 degrees.`);
}
export function validateBoss(feature:BossFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  validateOnFace(feature,earlier,missing,'Boss');
  if(!pos(feature.diameterMillimeters)||!pos(feature.heightMillimeters))throw Error('Boss diameter and height must be positive.');
  if((feature.holeDiameterMillimeters===undefined)!==(feature.holeDepthMillimeters===undefined))throw Error('A boss hole needs a diameter and a depth.');
  if(feature.holeDiameterMillimeters!==undefined&&(!pos(feature.holeDiameterMillimeters)||feature.holeDiameterMillimeters>=feature.diameterMillimeters||!pos(feature.holeDepthMillimeters)))throw Error('Boss hole must be positive and narrower than the boss.');
}
export function validateRest(feature:RestFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  validateOnFace(feature,earlier,missing,'Rest');
  if(!pos(feature.widthMillimeters)||!pos(feature.heightMillimeters))throw Error('Rest width and height must be positive.');
  if(feature.lengthMillimeters!==undefined&&!pos(feature.lengthMillimeters))throw Error('Rest length must be positive.');
  if(feature.alongMillimeters!==undefined&&!(Array.isArray(feature.alongMillimeters)&&feature.alongMillimeters.length===3&&feature.alongMillimeters.every(Number.isFinite)&&Math.hypot(...feature.alongMillimeters)>1e-9))throw Error('Rest direction must be a nonzero vector.');
}
