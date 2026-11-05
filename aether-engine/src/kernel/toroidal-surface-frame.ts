import type { BRepAdaptor_Surface } from 'replicad-opencascadejs';
import { getOC } from 'replicad';
import { pointTuple } from '../geometry/frames';
import { add, sub, scale, dot, cross, unit, norm, type V3 } from './vector';

/** Recover the exact torus frame using derivatives exposed by both WASM kernels.
 * P = O + (R + r cos(v)) radial(u) + r sin(v) axis.
 * P + Dvv = O + R radial; -Duu points radially outwards.
 * https://occt3d.com/dev/doc/refman/html/class_geom___toroidal_surface.html
 */
export function toroidalSurfaceFrame(surface: BRepAdaptor_Surface) {
  const oc = getOC();
  const p = new oc.gp_Pnt_1();
  const du = new oc.gp_Vec_1(), dv = new oc.gp_Vec_1();
  const duu = new oc.gp_Vec_1(), dvv = new oc.gp_Vec_1(), duv = new oc.gp_Vec_1();
  try {
    const tuple = (value: typeof du): V3 => [...pointTuple(value)];
    const u = (surface.FirstUParameter() + surface.LastUParameter()) / 2;
    const first = surface.FirstVParameter(), last = surface.LastVParameter();
    for (const fraction of [0.5, 0.25, 0.75]) {
      surface.D2(u, first + (last - first) * fraction, p, du, dv, duu, dvv, duv);
      const radialOffset = tuple(duu), radius = norm(radialOffset);
      if (!(radius > 1e-12)) continue;
      const radial = scale(radialOffset, -1 / radius);
      const majorRadius = radius + dot(tuple(dvv), radial);
      if (!(majorRadius > 1e-12)) continue;
      const axis = unit(cross(radial, tuple(du)));
      const origin = sub(add([...pointTuple(p)], tuple(dvv)), scale(radial, majorRadius));
      if (![...origin, ...axis, ...radial].every(Number.isFinite)) continue;
      return { origin, axis, radial };
    }
    throw new Error('The torus has no regular axial frame.');
  } finally {
    p.delete(); du.delete(); dv.delete(); duu.delete(); dvv.delete(); duv.delete();
  }
}
