/** Exact body combination. Consumed tools remain editable in feature history. */
export interface BooleanFeature {
  id: string;
  type: 'boolean';
  name: string;
  suppressed: boolean;
  operation: 'union' | 'cut' | 'intersection';
  targetBodyId: string;
  toolBodyIds: string[];
  keepTools: boolean;
}

export function validateBoolean(feature: BooleanFeature): void {
  if (!['union', 'cut', 'intersection'].includes(feature.operation))
    throw new Error('Choose Union, Cut or Intersection.');
  if (typeof feature.targetBodyId !== 'string' || !feature.targetBodyId.trim())
    throw new Error('Boolean needs a target body.');
  if (!Array.isArray(feature.toolBodyIds) || !feature.toolBodyIds.length
      || feature.toolBodyIds.some(id => typeof id !== 'string' || !id.trim()
        || id === feature.targetBodyId)
      || new Set(feature.toolBodyIds).size !== feature.toolBodyIds.length)
    throw new Error('Choose distinct tool bodies different from the target.');
  if (typeof feature.keepTools !== 'boolean') throw new Error('Invalid Keep tools setting.');
}
