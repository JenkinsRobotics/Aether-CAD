import { add, cross, dot, scale, sub, unit, type V3 } from './vector';

/** Normal of a drafted planar wall, fixed along its neutral sketch edge.
 * The draft is measured from the actual pull direction: m·pull = sin(angle).
 * Rotating by `angle` about the sketch tangent is only correct when the pull
 * is perpendicular to that tangent. The native DraftAngle operation uses this
 * same constraint; these vectors place the shared controls on that geometry.
 */
export function extrusionDraftWallNormal(outward: V3, sketchNormal: V3, pull: V3, degrees: number): V3 {
  const tangent = unit(cross(sketchNormal, outward));
  const perpendicular = sub(pull, scale(tangent, dot(pull, tangent)));
  const sine = Math.sin(degrees * Math.PI / 180) / Math.hypot(...perpendicular);
  if (Math.abs(sine) >= 1) throw Error('The draft angle is too large for this extrusion direction and profile edge. Reduce the angle or change the direction.');
  let originalNormal = unit(cross(tangent, pull));
  if (dot(originalNormal, outward) < 0) originalNormal = scale(originalNormal, -1);
  return add(scale(originalNormal, Math.sqrt(1 - sine * sine)), scale(unit(perpendicular), sine));
}

/** Shift of one wall in its sketch plane at the chosen axial start. */
export function extrusionDraftWallShift(outward: V3, sketchNormal: V3, pull: V3, degrees: number, offset: number): number {
  if (!degrees || !offset) return 0;
  const normal = extrusionDraftWallNormal(outward, sketchNormal, pull, degrees);
  const denominator = dot(normal, outward);
  if (Math.abs(denominator) < 1e-9) throw Error('The draft wall is parallel to its starting section. Reduce the angle or change the direction.');
  return -offset * dot(normal, pull) / denominator;
}
