import type { SketchEntityRef } from "../solver/types";
import { conicSubspanParameter } from '../../../../freecad-engine/browser/conic-geometry';
export interface RetainedContactInterval {
  contour: number;
  index: number;
  interval: [number, number];
  conicRho?: number;
}
/** Remap a finite contact only when its original parameter survives the cut.
 * Endpoints belong to retained pieces; sliding remains bounded to that piece. */
export function remapTrimContact(
  ref: SketchEntityRef,
  pieces: readonly RetainedContactInterval[],
): SketchEntityRef | undefined {
  const t = ref.parameter;
  if (t === undefined || !Number.isFinite(t) || t < 0 || t > 1)
    throw Error("Cannot trim an invalid curve contact.");
  const piece = pieces.find(
    ({ interval: [lo, hi] }) => t >= lo - 1e-8 && t <= hi + 1e-8,
  );
  if (!piece) return undefined;
  const [lo, hi] = piece.interval;
  return {
    ...ref,
    contour: piece.contour,
    index: piece.index,
    parameter: piece.conicRho === undefined ? Math.max(0, Math.min(1, (t - lo) / (hi - lo))) : conicSubspanParameter(piece.conicRho,t,lo,hi),
  };
}
