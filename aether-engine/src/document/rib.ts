import type {SketchPlane} from '../sketch/index';

/** Onshape's Rib (help: PartStudio/rib.htm): a thin wall built from open sketch curves, normal to
 *  the sketch plane until it meets the part, merged into it. Thickness is centred on the curve.
 *  "Parallel to sketch plane" (the wall filled in-plane from the curve to the part), the draft
 *  angle and "Extend profiles to part" are recorded gaps: the window refuses them with the reason. */
export interface RibFeature {
  id: string; type: 'rib'; name: string; suppressed: boolean;
  /** The sketch whose open curves are the rib profiles. */
  profileFeatureId: string;
  /** The curves used; absent means every open curve of the sketch. */
  profileContourIds?: string[];
  /** The part the rib joins. */
  targetBodyId: string;
  thicknessMillimeters: number;
  /** The wall's direction: square to the sketch plane (the only kind this kernel builds). */
  direction?: 'normal';
  /** Build toward the sketch plane's other side. */
  reversed?: boolean;
  /** Keep for the gallery's reading of saved files; always the sketch plane of the profile. */
  plane?: SketchPlane;
}

export function validateRib(feature: RibFeature, earlier: ReadonlyMap<string, string>, missing: (id: string) => boolean): void {
  if (typeof feature.profileFeatureId !== 'string' || (!missing(feature.profileFeatureId) && !['sketch', 'profile'].includes(earlier.get(feature.profileFeatureId) ?? ''))) throw new Error('Rib needs an earlier sketch with open curves.');
  if (feature.profileContourIds !== undefined && (!Array.isArray(feature.profileContourIds) || !feature.profileContourIds.length || !feature.profileContourIds.every((id) => typeof id === 'string' && id.trim()))) throw new Error('Choose the rib curves.');
  if (typeof feature.targetBodyId !== 'string' || !feature.targetBodyId.trim()) throw new Error('Rib needs the part to join.');
  if (!(Number.isFinite(feature.thicknessMillimeters) && feature.thicknessMillimeters > 0)) throw new Error('Rib thickness must be positive.');
  if (feature.direction !== undefined && feature.direction !== 'normal') throw new Error('Rib direction must be normal to the sketch plane (parallel is a recorded gap).');
  if (feature.reversed !== undefined && typeof feature.reversed !== 'boolean') throw new Error('Invalid rib direction flag.');
}
