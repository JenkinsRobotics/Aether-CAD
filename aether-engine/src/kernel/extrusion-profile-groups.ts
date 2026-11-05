import type { ExtrudeFeature } from '../document/part-document';
import type { SurfaceExtrudeFeature } from '../document/surface';

/** Each sketch keeps its own solved plane and curve identities. Grouping is
 * transient: one authored Extrude still owns the resulting native tool. */
export function extrusionProfileGroups<T extends ExtrudeFeature | SurfaceExtrudeFeature>(feature: T): T[] {
  if (!feature.profileSelections?.length) return [feature];
  const groups = new Map<string, NonNullable<ExtrudeFeature['profileSelections']>>();
  for (const selection of feature.profileSelections) {
    const group = groups.get(selection.profileFeatureId) ?? [];
    group.push(selection);
    groups.set(selection.profileFeatureId, group);
  }
  return [...groups].map(([profileFeatureId, profileSelections]) => ({ ...feature, profileFeatureId, profileSelections }));
}
