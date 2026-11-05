import { identifyProfileContours } from './profile-contour-identities';
import type { PartDocument, PartFeature } from './part-document';

/** New independent sheets need persistent authored curve identities before the
 * first rebuild, whether the feature came from the editor or an agent. Keep
 * legacy compound surfaces untouched. This is an atomic candidate, never an
 * in-place change to the source document. */
export function identifySurfaceExtrusionProfiles(document: PartDocument, feature: PartFeature): PartDocument {
  if (feature.type !== 'surface-extrude' || feature.operation !== 'new' || !feature.separateBodies) return document;
  let next = document;
  const sources = new Set(feature.profileSelections?.map(pick => pick.profileFeatureId) ?? [feature.profileFeatureId]);
  for (const id of sources) {
    if (next.features.find(source => source.id === id)?.type === 'profile')
      next = identifyProfileContours(next, id);
  }
  return next;
}
