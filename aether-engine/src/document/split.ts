import {validateMirrorPlane,type MirrorPlaneReference} from './mirror-plane';
import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';

/** Onshape's other splitting entities: a picked face of a part or surface. Untrimmed, a cylindrical,
 *  conical, spherical or toroidal face splits by its whole surface; trimmed to its boundary, any
 *  face (a surface body's face included) splits only where it crosses the part. */
export type SplitTool={kind:'face'}&SolidFaceReference;

/** Split Body (SolidCraft's solid.split_body): one part cut by a plane into the
 *  piece on the plane's normal side and the piece behind it. The target keeps
 *  its identity for the negative piece; the positive piece takes the recorded
 *  copy identity, so body history treats it like a transform copy. */
export interface SplitFeature {
  id:string;type:'split';name:string;suppressed:boolean;
  bodyIds:[string];
  copyBodyIds?:Record<string,string>;
  /** The splitting plane; or `tool`, a picked face. */
  plane?:MirrorPlaneReference;
  tool?:SplitTool;
  /** Onshape's Trim to face boundaries: the tool face splits only within its boundary (keeps both sides). */
  trimToFace?:boolean;
  /** Onshape's Keep tools: false consumes a surface body whose face was the tool; absent keeps it. */
  keepTools?:boolean;
  keep:'both'|'positive'|'negative';
}
export function validateSplit(feature:SplitFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  if(!Array.isArray(feature.bodyIds)||feature.bodyIds.length!==1||typeof feature.bodyIds[0]!=='string')throw Error('Split needs one solid part.');
  if(!['both','positive','negative'].includes(feature.keep))throw Error('Split keeps both pieces, the positive side or the negative side.');
  if(feature.keep==='both'){
    if(!feature.copyBodyIds||typeof feature.copyBodyIds[feature.bodyIds[0]]!=='string')throw Error('Split keeping both pieces needs a new body identity for the second piece.');
  }else if(feature.copyBodyIds!==undefined)throw Error('Only a split keeping both pieces makes a second body.');
  if((feature.plane===undefined)===(feature.tool===undefined))throw Error('Split needs one entity to split with: a plane or a face.');
  if(feature.plane)validateMirrorPlane(feature.plane,earlier,missing,'Split plane');
  if(feature.tool){
    if(feature.tool.kind!=='face')throw Error('The splitting entity must be a picked face.');
    validateSolidFaceReference(feature.tool,earlier,missing,'Split face');
    if(!feature.trimToFace&&!['cylinder','cone','sphere','torus'].includes(feature.tool.surfaceType??''))throw Error('An untrimmed split face must be cylindrical, conical, spherical or toroidal (planar faces split through the plane box); check Trim to face boundaries for other faces.');
    if(feature.trimToFace&&feature.keep!=='both')throw Error('A split trimmed to the face keeps both sides.');
  }
  for(const flag of ['trimToFace','keepTools'] as const)if(feature[flag]!==undefined&&typeof feature[flag]!=='boolean')throw Error(`${flag} must be true or false.`);
}
