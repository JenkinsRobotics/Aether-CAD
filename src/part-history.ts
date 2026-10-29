import type { PartFeature } from "./part-document";

/** Placement changes remain in replay/history, but do not define a new shape.
 * Copies, mirrors and scales still belong in the modeling feature tree. */
export function isPartPlacementAction(feature: PartFeature): boolean {
  if (feature.type !== "transform" || Object.keys(feature.copyBodyIds ?? {}).length) return false;
  return ["translate", "rotate", "translate-reference", "rotate-reference", "align"].includes(feature.transform.kind);
}
