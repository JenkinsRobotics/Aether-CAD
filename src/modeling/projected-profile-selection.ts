import { identifySketchContour, resolveProfileDrawing, type PartDocument, type ProfileFeature, type SketchRegion } from "@aether/core/document";
import { regionBoundaryIdentity } from "@aether/core/sketch/reference/connected-sketch-regions";
import type { ProfileRegionSelection } from "@aether/core/sketch/reference/profile-region-reference";

/** Resolved drawings prepend reference contours. Only wholly authored regions
 * can be stamped here; projected boundaries need their own source identity path. */
export function isAuthoredProjectionRegion(feature: ProfileFeature, resolvedCount: number, region: SketchRegion): boolean {
  if (feature.profile.type !== "projection" || !feature.profile.authored || region.ordinal !== undefined) return false;
  const count = feature.profile.authored.contours.length;
  const offset = resolvedCount - count;
  const indices = [...(region.sourceContourIndices ?? [region.contourIndex]), ...(region.insideContourIndices ?? [])];
  return indices.length > 0 && indices.every(index => Number.isInteger(index) && index >= offset && index < resolvedCount);
}

export function stampAuthoredProjectionRegion(
  document: PartDocument,
  feature: ProfileFeature,
  region: SketchRegion,
): { profileFeatureId: string } & ProfileRegionSelection {
  const profile = feature.profile;
  const resolved = resolveProfileDrawing(document.features, feature.id);
  if (profile.type !== "projection" || !profile.authored || !isAuthoredProjectionRegion(feature, resolved.contours.length, region))
    throw Error("Select a region bounded only by authored geometry. Projected boundaries cannot be stamped here.");
  const authored = structuredClone(profile.authored);
  const offset = resolved.contours.length - authored.contours.length;
  const identify = (index: number) => {
    const contour = authored.contours[index - offset];
    identifySketchContour(contour, () => crypto.randomUUID());
    return contour.id!;
  };
  const base = { profileFeatureId: feature.id };
  let selection: typeof base & ProfileRegionSelection;
  if (!region.sourceContourIndices) {
    selection = { ...base, profileContourId: identify(region.contourIndex) };
  } else {
    const contourIds = region.sourceContourIndices.map(identify);
    const inside = region.insideContourIndices?.map(identify);
    const identified = resolveProfileDrawing(document.features.map(candidate => candidate.id === feature.id
      ? { ...feature, profile: { ...profile, authored } } : candidate), feature.id);
    const boundary = region.boundarySides ? regionBoundaryIdentity(identified, region.boundarySides) : undefined;
    selection = { ...base, profileRegion: { contourIds, ...(inside ? { inside } : {}), ...(boundary ? { boundary } : {}) } };
  }
  // Do not flatten the projection or copy solved source coordinates into it.
  profile.authored = authored;
  return selection;
}
