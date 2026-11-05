import { getOC, type Face } from 'replicad';
import { conicalSurfaceFrame } from './conical-surface-frame';
import { unit, type V3 } from './vector';

/** The analytic surface axis, independent of tessellation and face orientation. */
export function nativeFaceAxisDirection(face: Face): V3 {
  const surface = new (getOC()).BRepAdaptor_Surface_2(face.wrapped, true);
  try {
    if (face.geomType === 'CONE') return unit([...conicalSurfaceFrame(surface).axis]);
    if (!['CYLINDRE', 'CYLINDER'].includes(face.geomType)) {
      throw Error('Extrusion axis needs a cylindrical or conical face.');
    }
    const cylinder = surface.Cylinder();
    try {
      const axis = cylinder.Axis();
      try {
        const direction = axis.Direction();
        try { return unit([direction.X(), direction.Y(), direction.Z()]); }
        finally { direction.delete(); }
      } finally { axis.delete(); }
    } finally { cylinder.delete(); }
  } finally { surface.delete(); }
}
