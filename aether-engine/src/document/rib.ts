import type {SketchPlane} from '../sketch/index';

/** Onshape's Rib (help: PartStudio/rib.htm): a thin wall built from open sketch curves, merged into
 *  the part. Normal to the sketch plane: the wall is centred on the curve and runs square to the
 *  plane until it meets the part. Parallel to the sketch plane: the wall stands `thickness` tall
 *  across the plane and fills in-plane from the curve to the part (square to the curve's chord). The
 *  draft angle and "Extend profiles to part" are recorded gaps: the window refuses them with the reason. */
export interface RibFeature {
  id: string; type: 'rib'; name: string; suppressed: boolean;
  /** The sketch whose open curves are the rib profiles. */
  profileFeatureId: string;
  /** The curves used; absent means every open curve of the sketch. */
  profileContourIds?: string[];
  /** The part the rib joins. */
  targetBodyId: string;
  thicknessMillimeters: number;
  /** The wall's direction: square to the sketch plane (default), or in the plane from the curve to the part. */
  direction?: 'normal' | 'parallel';
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
  if (feature.direction !== undefined && !['normal', 'parallel'].includes(feature.direction)) throw new Error('Rib direction must be normal or parallel to the sketch plane.');
  if (feature.reversed !== undefined && typeof feature.reversed !== 'boolean') throw new Error('Invalid rib direction flag.');
}
