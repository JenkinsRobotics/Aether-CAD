import {validateSolidEdgeReference,type SolidEdgeReference} from './solid-edge-reference';

/** A pattern direction beyond the principal axes: a fixed vector, or a picked straight edge. */
export type PatternDirection={kind:'vector';direction:[number,number,number]}|SolidEdgeReference;
/** A polar axis beyond the principal axes: a fixed line, or a picked straight edge. */
export type PatternAxis={kind:'vector';origin:[number,number,number];direction:[number,number,number]}|{kind:'feature';featureId:string}|SolidEdgeReference;

/** Repeated native additive/subtractive feature intent, not copied meshes. */
export type PatternFeature = {
  id: string;
  type: 'pattern';
  name: string;
  suppressed: boolean;
  sourceFeatureId: string;
  /** Pattern whole parts instead of the source feature's tool: each copy is a new part `${copyBodyIds[id]}:${i}`. */
  bodyIds?: string[];
  copyBodyIds?: Record<string,string>;
  axis: 'X' | 'Y' | 'Z';
  count: number;
  reversed: boolean;
  /** Where the original sits in the row: first (right, the default), middle, or last. */
  alignment?: 'left' | 'center' | 'right';
  targetBodyId?: string;
} & (
  | {patternType:'linear';spacingMillimeters:number;
     /** Replaces `axis` when present. */ direction?: PatternDirection;
     /** A second row of the whole first row. */ second?: {axis?: 'X' | 'Y' | 'Z'; direction?: PatternDirection; count: number; spacingMillimeters: number; reversed?: boolean; alignment?: 'left' | 'center' | 'right'}}
  | {patternType:'polar';angleDegrees:number; /** Replaces `axis` (through the origin) when present. */ axisReference?: PatternAxis}
  | {patternType:'path';pathFeatureId:string;pathContourId?:string;spacingMillimeters?:number;distanceMillimeters?:number;orientation?:'identical'|'path'}
);

/** A pattern or mirror source repeats its copies together (PartDesign MultiTransform). */
export const patternSourceTypes = ['extrude','revolve','sweep','loft','hole','pattern','mirror'] as const;

/** The copies a part pattern makes: count − 1 per row (rows multiply with a second direction). */
export function patternCopyIds(feature: PatternFeature): string[] {
  if (!feature.bodyIds || !feature.copyBodyIds) return [];
  const copies = (feature.patternType === 'linear' && feature.second ? feature.count * feature.second.count : feature.count) - 1;
  return feature.bodyIds.flatMap((id) => Array.from({ length: copies }, (_, i) => `${feature.copyBodyIds![id]}:${i + 1}`));
}

export function validatePattern(feature:PatternFeature,earlier:Map<string,string>,missing:(id:unknown)=>boolean):void {
  if (typeof feature.sourceFeatureId !== 'string' || (!missing(feature.sourceFeatureId) && !(patternSourceTypes as readonly string[]).includes(earlier.get(feature.sourceFeatureId) ?? '')))
    throw new Error('Pattern must reference an earlier additive or subtractive feature.');
  if (feature.bodyIds !== undefined) {
    if (!Array.isArray(feature.bodyIds) || !feature.bodyIds.length || !feature.bodyIds.every((id) => typeof id === 'string')) throw new Error('Choose the parts to pattern.');
    if (!feature.copyBodyIds || feature.bodyIds.some((id) => typeof feature.copyBodyIds![id] !== 'string')) throw new Error('A part pattern needs a new identity for its copies.');
  } else if (feature.copyBodyIds !== undefined) throw new Error('Copy identities belong to a part pattern.');
  if (!Number.isInteger(feature.count) || feature.count < 2) throw new Error('Pattern needs at least two occurrences, including the original.');
  if (!['X','Y','Z'].includes(feature.axis) || typeof feature.reversed!=='boolean') throw new Error('Invalid pattern axis or direction.');
  if (feature.alignment !== undefined && !['left','center','right'].includes(feature.alignment)) throw new Error('Pattern alignment must be left, center or right.');
  const unit=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)&&Math.hypot(...(v as number[]))>1e-9;
  const direction=(ref:PatternDirection|undefined,label:string)=>{
    if(ref===undefined)return;
    if(ref.kind==='vector'){if(!unit(ref.direction))throw new Error(`${label} needs a nonzero direction.`);return;}
    if(ref.kind==='solid-edge'){validateSolidEdgeReference(ref,earlier,missing);return;}
    throw new Error(`${label} must be a vector or a straight solid edge.`);
  };
  if (feature.patternType === 'linear') {
    if (!Number.isFinite(feature.spacingMillimeters) || feature.spacingMillimeters<=0) throw new Error('Pattern spacing must be positive.');
    direction(feature.direction,'Pattern direction');
    if(feature.second!==undefined){
      const s=feature.second;
      if(!Number.isInteger(s.count)||s.count<2)throw new Error('The second pattern direction needs at least two occurrences.');
      if(!Number.isFinite(s.spacingMillimeters)||s.spacingMillimeters<=0)throw new Error('The second pattern spacing must be positive.');
      if(s.axis!==undefined&&!['X','Y','Z'].includes(s.axis))throw new Error('Invalid second pattern axis.');
      if(s.alignment!==undefined&&!['left','center','right'].includes(s.alignment))throw new Error('Pattern alignment must be left, center or right.');
      direction(s.direction,'Second pattern direction');
    }
  } else if (feature.patternType === 'polar') {
    if(feature.axisReference!==undefined){
      const a=feature.axisReference;
      if(a.kind==='vector'){if(!Array.isArray(a.origin)||a.origin.length!==3||!a.origin.every(Number.isFinite)||!unit(a.direction))throw new Error('Pattern axis needs a finite origin and a nonzero direction.');}
      else if(a.kind==='solid-edge')validateSolidEdgeReference(a,earlier,missing);
      else if(a.kind==='feature'){if(typeof a.featureId!=='string'||(!missing(a.featureId)&&earlier.get(a.featureId)!=='axis'))throw new Error('Pattern axis must be an earlier axis feature.');}
      else throw new Error('Pattern axis must be a line, an axis feature or a straight solid edge.');
    }
    if (!Number.isFinite(feature.angleDegrees) || feature.angleDegrees<=0 || feature.angleDegrees>360) throw new Error('Pattern angle must be greater than 0 and at most 360 degrees.');
  } else if (feature.patternType === 'path') {
    if(typeof feature.pathFeatureId!=='string'||(!missing(feature.pathFeatureId)&&!['sketch','profile','curve3d'].includes(earlier.get(feature.pathFeatureId)??'')))throw new Error('Pattern on path needs a curve of an earlier sketch.');
    if((feature.spacingMillimeters===undefined)===(feature.distanceMillimeters===undefined))throw new Error('Pattern on path takes a spacing or an overall distance, not both.');
    if(feature.spacingMillimeters!==undefined&&!(feature.spacingMillimeters>0))throw new Error('Pattern spacing must be positive.');
    if(feature.distanceMillimeters!==undefined&&!(feature.distanceMillimeters>0))throw new Error('Pattern distance must be positive.');
    if(feature.orientation!==undefined&&!['identical','path'].includes(feature.orientation))throw new Error('Pattern orientation must be identical or path.');
  } else throw new Error('Unknown pattern type.');
}
