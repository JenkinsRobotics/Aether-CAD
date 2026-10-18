import type { SketchEntityRef, DrawingConstraint } from "../solver/types";
import { conicSubspanParameter } from '../../../../freecad-engine/browser/conic-geometry';
export function splitPreservesContact(
  c: DrawingConstraint,
  ref: SketchEntityRef,
): boolean {
  return (
    ref.kind === "curve" &&
    ["coincident", "pierce", "tangent", "curvature", "normal"].includes(c.kind)
  );
}
/** Piecewise affine parameter mapping preserves the same exact contact point. */
export function remapSplitContact(
  ref: SketchEntityRef,
  contour: number,
  segment: number,
  split: number,
  conicRho?: number,
): SketchEntityRef {
  if (ref.contour !== contour || ref.kind !== "curve" || ref.index !== segment)
    return ref;
  const t = ref.parameter;
  if (t === undefined || !Number.isFinite(t) || t < 0 || t > 1)
    throw Error("Cannot split an invalid curve contact.");
  const left = t <= split;
  return {
    ...ref,
    index: segment + (left ? 0 : 1),
    parameter: conicRho === undefined ? (left ? t / split : (t - split) / (1 - split)) : conicSubspanParameter(conicRho,t,left?0:split,left?split:1),
  };
}
