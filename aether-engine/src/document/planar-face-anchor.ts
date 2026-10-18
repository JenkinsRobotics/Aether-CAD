/** Exact geometric discriminator when several planar faces share a normal.
 * Changed geometry requires explicit reselection; this is not a FaceN index. */
export interface PlanarFaceAnchor {
  centerMillimeters: [number, number, number];
  areaSquareMillimeters: number;
}

export function validatePlanarFaceAnchor(anchor: PlanarFaceAnchor | undefined): void {
  if (anchor === undefined) return;
  if (!anchor || !Array.isArray(anchor.centerMillimeters) || anchor.centerMillimeters.length !== 3 ||
      !anchor.centerMillimeters.every(Number.isFinite) || !Number.isFinite(anchor.areaSquareMillimeters) || anchor.areaSquareMillimeters <= 0)
    throw Error('Invalid planar face anchor. Reselect the face.');
}
