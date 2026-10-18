/** Repeated native additive/subtractive feature intent, not copied meshes. */
export type PatternFeature = {
  id: string;
  type: 'pattern';
  name: string;
  suppressed: boolean;
  sourceFeatureId: string;
  axis: 'X' | 'Y' | 'Z';
  count: number;
  reversed: boolean;
  targetBodyId?: string;
} & ({patternType:'linear';spacingMillimeters:number} | {patternType:'polar';angleDegrees:number});

export const patternSourceTypes = ['extrude','revolve','sweep','loft','hole'] as const;

export function validatePattern(feature:PatternFeature,earlier:Map<string,string>,missing:(id:unknown)=>boolean):void {
  if (typeof feature.sourceFeatureId !== 'string' || (!missing(feature.sourceFeatureId) && !(patternSourceTypes as readonly string[]).includes(earlier.get(feature.sourceFeatureId) ?? '')))
    throw new Error('Pattern must reference an earlier additive or subtractive feature.');
  if (!Number.isInteger(feature.count) || feature.count < 2) throw new Error('Pattern needs at least two occurrences, including the original.');
  if (!['X','Y','Z'].includes(feature.axis) || typeof feature.reversed!=='boolean') throw new Error('Invalid pattern axis or direction.');
  if (feature.patternType === 'linear') {
    if (!Number.isFinite(feature.spacingMillimeters) || feature.spacingMillimeters<=0) throw new Error('Pattern spacing must be positive.');
  } else if (feature.patternType === 'polar') {
    if (!Number.isFinite(feature.angleDegrees) || feature.angleDegrees<=0 || feature.angleDegrees>360) throw new Error('Pattern angle must be greater than 0 and at most 360 degrees.');
  } else throw new Error('Unknown pattern type.');
}
