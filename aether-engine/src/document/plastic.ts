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
export interface BossRibsSpec {
  /** Number of radial stiffening gusset ribs around the boss (2–12). */
  count: number;
  thicknessMillimeters: number;
  /** Radial protrusion beyond the boss outer surface (mm). */
  lengthMillimeters: number;
  /** Rib height along the boss (defaults to 75% of boss height). */
  heightMillimeters?: number;
}
export interface BossFeature extends OnFace {
  id:string;type:'boss';name:string;suppressed:boolean;
  diameterMillimeters:number;heightMillimeters:number;
  holeDiameterMillimeters?:number;holeDepthMillimeters?:number;
  /** Optional radial mounting gusset ribs around the boss. */
  ribs?:BossRibsSpec;
}
export interface RestFeature extends OnFace {
  id:string;type:'rest';name:string;suppressed:boolean;
  /** Round: the diameter. Rectangular (with a length): the width. */
  widthMillimeters:number;lengthMillimeters?:number;heightMillimeters:number;
  /** A rectangle's length direction (in the face); default: the face's x direction. */
  alongMillimeters?:[number,number,number];
  /** Optional hollow wall thickness (mm); removes the core from the top leaving walls of this thickness. */
  wallThicknessMillimeters?:number;
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
  if(feature.ribs!==undefined){
    const r=feature.ribs;
    if(!Number.isInteger(r.count)||r.count<2||r.count>12)throw Error('Boss ribs count must be an integer between 2 and 12.');
    if(!pos(r.thicknessMillimeters)||!pos(r.lengthMillimeters))throw Error('Boss rib thickness and length must be positive.');
    if(r.heightMillimeters!==undefined&&(!pos(r.heightMillimeters)||r.heightMillimeters>feature.heightMillimeters))throw Error('Boss rib height must be positive and not exceed the boss height.');
  }
}
export function validateRest(feature:RestFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  validateOnFace(feature,earlier,missing,'Rest');
  if(!pos(feature.widthMillimeters)||!pos(feature.heightMillimeters))throw Error('Rest width and height must be positive.');
  if(feature.lengthMillimeters!==undefined&&!pos(feature.lengthMillimeters))throw Error('Rest length must be positive.');
  if(feature.alongMillimeters!==undefined&&!(Array.isArray(feature.alongMillimeters)&&feature.alongMillimeters.length===3&&feature.alongMillimeters.every(Number.isFinite)&&Math.hypot(...feature.alongMillimeters)>1e-9))throw Error('Rest direction must be a nonzero vector.');
  if(feature.wallThicknessMillimeters!==undefined){
    const minSpan=feature.lengthMillimeters!==undefined?Math.min(feature.widthMillimeters,feature.lengthMillimeters):feature.widthMillimeters;
    if(!pos(feature.wallThicknessMillimeters)||feature.wallThicknessMillimeters*2>=minSpan)throw Error('Rest wall thickness must be positive and less than half the pad width.');
  }
}

/** Lip / groove (SolidCraft's plastic.lip): a band along the inside or outside edge of a
 *  shelled body's rim face, raised (lip) or sunk (groove, widened by the clearance gap). */
export interface LipFeature {
  id:string;type:'lip';name:string;suppressed:boolean;
  targetBodyId:string;
  face:SolidFaceReference;
  shape:'lip'|'groove';
  side:'inside'|'outside';
  widthMillimeters:number;heightMillimeters:number;
  /** Groove clearance added to the width; default: none. */
  gapMillimeters?:number;
}
/** Snap fit (plastic.snap_fit): a cantilever hook out of a face at a point. */
export interface SnapFitFeature extends OnFace {
  id:string;type:'snap-fit';name:string;suppressed:boolean;
  /** Which way the catch faces, across the face. */
  hookDirectionMillimeters:[number,number,number];
  lengthMillimeters:number;thicknessMillimeters:number;widthMillimeters:number;
  catchDepthMillimeters:number;catchLengthMillimeters:number;
  /** Optional thickened base pedestal height at the root of the cantilever arm (mm). */
  baseHeightMillimeters?:number;
}
export function validateLip(feature:LipFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  if(typeof feature.targetBodyId!=='string')throw Error('Lip needs a target part.');
  validateSolidFaceReference(feature.face,earlier,missing,'Lip face');
  if(feature.face.surfaceType)throw Error('A lip goes on a planar rim face.');
  if(!['lip','groove'].includes(feature.shape)||!['inside','outside'].includes(feature.side))throw Error('Lip needs a shape (lip or groove) and a side.');
  if(!pos(feature.widthMillimeters)||!pos(feature.heightMillimeters))throw Error('Lip width and height must be positive.');
  if(feature.gapMillimeters!==undefined&&!(Number.isFinite(feature.gapMillimeters)&&feature.gapMillimeters>=0))throw Error('Groove gap must be zero or more.');
}
export function validateSnapFit(feature:SnapFitFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  validateOnFace(feature,earlier,missing,'Snap fit');
  const h=feature.hookDirectionMillimeters;
  if(!Array.isArray(h)||h.length!==3||!h.every(Number.isFinite)||Math.hypot(...h)<1e-9)throw Error('Snap fit needs a hook direction.');
  if(![feature.lengthMillimeters,feature.thicknessMillimeters,feature.widthMillimeters,feature.catchDepthMillimeters,feature.catchLengthMillimeters].every(pos))throw Error('Snap fit sizes must be positive.');
  if(feature.catchLengthMillimeters>=feature.lengthMillimeters)throw Error('The catch must be shorter than the arm.');
  if(feature.baseHeightMillimeters!==undefined&&(!pos(feature.baseHeightMillimeters)||feature.baseHeightMillimeters>=feature.lengthMillimeters-feature.catchLengthMillimeters))throw Error('Snap fit base height must be positive and shorter than the arm below the catch.');
}
