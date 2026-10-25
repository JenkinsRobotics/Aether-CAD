import type { PartDocument } from "./part-document";
import { featureReferenceErrors } from "./feature-errors";
import { resolveProfileDrawing } from "./profile-projection";
import { captureDistanceSides } from "../sketch/solver/distance-side";

/** Capture legacy unsigned intent at the read/save boundary, before later source
 * edits. Missing sources remain repairable; no unavailable geometry is invented.
 * This never solves or rewrites the user's authored coordinates. */
export function withDocumentDistanceIntent(document: PartDocument): PartDocument {
  const next = structuredClone(document);
  const unavailable = featureReferenceErrors({ ...next, rollbackIndex: undefined });
  for (const feature of next.features) {
    if (feature.type !== "profile" || unavailable.has(feature.id)) continue;
    const profile = feature.profile;
    const drawing = profile.type === "drawing" ? profile
      : profile.type === "projection" ? profile.authored : undefined;
    if (!drawing?.constraints?.some(c => c.kind === "distance" && !c.reference && c.distanceSide === undefined)) continue;
    const context = profile.type === "projection"
      ? resolveProfileDrawing(next.features.map(f => f.id === feature.id
        ? { ...feature, suppressed: false, profile: { ...profile, authored: undefined } } : f), feature.id).contours
      : undefined;
    const draft = { ...drawing, ...(context ? { projectionContext: context } : {}) };
    captureDistanceSides(draft);
  }
  return next;
}
