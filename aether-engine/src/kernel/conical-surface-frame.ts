import type { BRepAdaptor_Surface } from "replicad-opencascadejs";
import { getOC } from "replicad";
import type { Vec3 } from "../contracts/index";
import { pointTuple } from "../geometry/frames";

const mapVector = (vector: Vec3, map: (value: number, index: number) => number): Vec3 =>
  [map(vector[0], 0), map(vector[1], 1), map(vector[2], 2)];

/** The compact OCCT build exposes surface derivatives but not gp_Cone. Recover
 * the exact cone axis from its analytic derivatives, without fitting the mesh.
 * For OCCT's cone parameterization, P + Duu is the axis station at v, and
 * Dv with its radial component removed is cos(semiAngle) times the axis.
 * https://occt3d.com/dev/doc/refman/html/class_geom___conical_surface.html
 */
export function conicalSurfaceFrame(surface: BRepAdaptor_Surface) {
  const oc = getOC();
  const point = new oc.gp_Pnt_1();
  const du = new oc.gp_Vec_1(), dv = new oc.gp_Vec_1();
  const duu = new oc.gp_Vec_1(), dvv = new oc.gp_Vec_1(), duv = new oc.gp_Vec_1();
  try {
    const u = (surface.FirstUParameter() + surface.LastUParameter()) / 2;
    const firstV = surface.FirstVParameter(), lastV = surface.LastVParameter();
    // A trimmed face can straddle the apex. Try an interior station away from it.
    for (const fraction of [0.5, 0.25, 0.75]) {
      const v = firstV + (lastV - firstV) * fraction;
      surface.D2(u, v, point, du, dv, duu, dvv, duv);
      const radialOffset = pointTuple(duu), derivative = pointTuple(dv);
      const radius = Math.hypot(...radialOffset);
      if (!(radius > 1e-12)) continue;
      const radial = mapVector(radialOffset, value => -value / radius);
      const radialSpeed = derivative.reduce((sum, value, i) => sum + value * radial[i], 0);
      const axial = mapVector(derivative, (value, i) => value - radialSpeed * radial[i]);
      const axialScale = Math.hypot(...axial);
      if (!(axialScale > 1e-12)) continue;
      const axis = mapVector(axial, value => value / axialScale);
      const station = mapVector(pointTuple(point), (value, i) => value + radialOffset[i]);
      const origin = mapVector(station, (value, i) => value - axis[i] * v * axialScale);
      if (![...origin, ...axis, ...radial, axialScale].every(Number.isFinite)) continue;
      return { origin, axis, radial, axialScale, firstV, lastV };
    }
    throw new Error("The cone has no regular axial station.");
  } finally {
    point.delete(); du.delete(); dv.delete(); duu.delete(); dvv.delete(); duv.delete();
  }
}
