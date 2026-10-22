import {validateMirrorPlane,type MirrorPlaneReference} from './mirror-plane';

/** Split Body (SolidCraft's solid.split_body): one part cut by a plane into the
 *  piece on the plane's normal side and the piece behind it. The target keeps
 *  its identity for the negative piece; the positive piece takes the recorded
 *  copy identity, so body history treats it like a transform copy. */
export interface SplitFeature {
  id:string;type:'split';name:string;suppressed:boolean;
  bodyIds:[string];
  copyBodyIds?:Record<string,string>;
  plane:MirrorPlaneReference;
  keep:'both'|'positive'|'negative';
}
export function validateSplit(feature:SplitFeature,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
  if(!Array.isArray(feature.bodyIds)||feature.bodyIds.length!==1||typeof feature.bodyIds[0]!=='string')throw Error('Split needs one solid part.');
  if(!['both','positive','negative'].includes(feature.keep))throw Error('Split keeps both pieces, the positive side or the negative side.');
  if(feature.keep==='both'){
    if(!feature.copyBodyIds||typeof feature.copyBodyIds[feature.bodyIds[0]]!=='string')throw Error('Split keeping both pieces needs a new body identity for the second piece.');
  }else if(feature.copyBodyIds!==undefined)throw Error('Only a split keeping both pieces makes a second body.');
  validateMirrorPlane(feature.plane,earlier,missing,'Split plane');
}
