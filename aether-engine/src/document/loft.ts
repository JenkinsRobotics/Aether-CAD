import { validateProfileRegionSelection, profileRegionIdentity, type ProfileRegionSelection } from '../../../freecad-engine/browser/profile-region-reference';
/** Ordered sketch sections evaluated by the native PartDesign loft adapter. */
export interface LoftFeature {
  id: string;
  type: 'loft';
  name: string;
  suppressed: boolean;
  sections: ({profileFeatureId: string} & ProfileRegionSelection)[];
  operation: 'new' | 'add' | 'cut';
  ruled: boolean;
  bodyId?: string;
  targetBodyId?: string;
}

export function validateLoft(feature: LoftFeature, earlier: Map<string,string>, missing: (id: unknown)=>boolean): void {
  if (!Array.isArray(feature.sections) || feature.sections.length < 2)
    throw new Error('Loft needs at least two ordered sketch sections.');
  const identities = new Set<string>();
  for (const section of feature.sections) {
    if (!section || typeof section.profileFeatureId !== 'string' || (!missing(section.profileFeatureId) && !['sketch','profile'].includes(earlier.get(section.profileFeatureId) ?? '')))
      throw new Error('Each loft section must reference an earlier sketch.');
    if (section.profileContourId !== undefined && (typeof section.profileContourId !== 'string' || !section.profileContourId.trim() || section.profileContourId.length > 128))
      throw new Error('Invalid loft contour reference.');
    validateProfileRegionSelection(section);
    const identity = JSON.stringify([section.profileFeatureId, profileRegionIdentity(section)]);
    if (identities.has(identity)) throw new Error('A loft section cannot be selected twice.');
    identities.add(identity);
  }
  if (!['new','add','cut'].includes(feature.operation) || typeof feature.ruled !== 'boolean')
    throw new Error('Invalid loft operation or surface mode.');
}
