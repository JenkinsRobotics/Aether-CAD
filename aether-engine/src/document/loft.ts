import { validateProfileRegionSelection, profileRegionIdentity, type ProfileRegionSelection } from '../sketch/reference/profile-region-reference';
import { validateExtrusionPointReference, type ExtrusionPointReference } from './extrusion-point-reference';

/** An apex the loft runs to: a picked vertex / sketch point, or a point given outright. */
export type LoftApex = ExtrusionPointReference | { kind: 'point'; positionMillimeters: [number, number, number] };
/** Ordered sketch sections evaluated by the native PartDesign loft adapter. */
export interface LoftFeature {
  id: string;
  type: 'loft';
  name: string;
  suppressed: boolean;
  sections: ({profileFeatureId: string} & ProfileRegionSelection)[];
  /** Apex before the first section / after the last (SolidCraft's point sections). */
  startPoint?: LoftApex;
  endPoint?: LoftApex;
  /** Onshape's Path: the sections are swept along this curve of an earlier sketch (OCCT's pipe shell through several profiles). */
  path?: { pathFeatureId: string; pathContourId?: string };
  /** Onshape's Connections: one sketch point per section, in section order; each section's boundary starts at its point so the vertices pair up. */
  connections?: ExtrusionPointReference[][];
  operation: 'new' | 'add' | 'cut';
  ruled: boolean;
  bodyId?: string;
  targetBodyId?: string;
}

export function validateLoft(feature: LoftFeature, earlier: Map<string,string>, missing: (id: unknown)=>boolean): void {
  const apexes = [feature.startPoint, feature.endPoint].filter((a) => a !== undefined);
  for (const apex of apexes) {
    if (apex!.kind === 'point') { if (!Array.isArray(apex!.positionMillimeters) || apex!.positionMillimeters.length !== 3 || !apex!.positionMillimeters.every(Number.isFinite)) throw new Error('Loft apex needs a finite position.'); }
    else validateExtrusionPointReference(apex!, earlier, missing as (id: string) => boolean);
  }
  if (!Array.isArray(feature.sections) || feature.sections.length + apexes.length < 2 || !feature.sections.length)
    throw new Error('Loft needs at least two ordered sections (sketches, or a sketch and an apex).');
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
  if (feature.path !== undefined) {
    if (typeof feature.path.pathFeatureId !== 'string' || (!missing(feature.path.pathFeatureId) && !['sketch','profile','curve3d'].includes(earlier.get(feature.path.pathFeatureId) ?? ''))) throw new Error('Loft path needs a curve of an earlier sketch.');
    if (apexes.length || feature.ruled) throw new Error('A loft along a path takes closed sections only, smooth, without an apex.');
  }
  if (feature.connections !== undefined) {
    if (!Array.isArray(feature.connections) || !feature.connections.length) throw new Error('Loft connections need at least one set of points.');
    for (const set of feature.connections) {
      if (!Array.isArray(set) || set.length !== feature.sections.length) throw new Error('Each loft connection needs one sketch point per section, in section order.');
      for (const point of set) validateExtrusionPointReference(point, earlier, missing as (id: string) => boolean);
    }
  }
}
