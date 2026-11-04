import { drawRectangle, makeCylinder, Plane, type Face, type Shape3D } from "replicad";
import type { FullRoundFillet, SolidFaceReference } from "../../document/index";
import { deleteAfterVectorTuple } from "../../geometry/index";
import { add, cross, dot, scale, sub, unit, type V3 } from "../vector";

/** Onshape's Full round for two parallel planar side faces: each planar face to replace is cut back
 *  to the mid-depth plane and the inscribed cylinder (radius = half the side spacing, tangent to
 *  both sides and to the replaced face) is fused in, clipped to the body's extent along the strip.
 *  Side faces that are not parallel planes, or a replaced face that does not run between them, are
 *  refused: the kernel has no general full-round blend (ledger: Fillet, Full round). */
export function buildFullRound(feature: FullRoundFillet, body: Shape3D, faceByReference: (body: Shape3D, reference: SolidFaceReference, label: string) => Face, own: <T>(value: T) => T): Shape3D {
  const planeOf = (face: Face, label: string): { normal: V3; center: V3 } => {
    if (face.geomType !== "PLANE") throw new Error(`${label} must be planar: this kernel builds full rounds between parallel planar faces only.`);
    const center = [...deleteAfterVectorTuple(face.center)] as V3;
    return { normal: unit([...deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]))] as V3), center };
  };
  const side = planeOf(faceByReference(body, feature.sideFace, "Side face"), "Side face");
  const opposite = planeOf(faceByReference(body, feature.oppositeSideFace, "Opposite side face"), "Opposite side face");
  if (dot(side.normal, opposite.normal) > -1 + 1e-6) throw new Error("Side face and Opposite side face must be parallel and facing away from each other: this kernel builds full rounds between parallel planar faces only.");
  const width = dot(sub(opposite.center, side.center), side.normal);
  if (!(width < -1e-6)) throw new Error("The side faces must face outward with the faces to replace between them.");
  const radius = -width / 2;
  const midPlanePoint = add(side.center, scale(side.normal, width / 2));
  // The body's reach, so tools and the cylinder run past every end of the strip.
  const box = body.boundingBox, reach = 2 * Math.hypot(...sub(box.bounds[1] as V3, box.bounds[0] as V3)) + 1;
  let result = body;
  for (const reference of feature.replacedFaces) {
    const replaced = planeOf(faceByReference(result, reference, "Faces to replace"), "A face to replace");
    if (Math.abs(dot(replaced.normal, side.normal)) > 1e-6) throw new Error(`${reference.label} does not run between the side faces.`);
    const along = unit(cross(replaced.normal, side.normal));
    // The axis: on the mid-plane between the sides, one radius below the replaced face.
    const onMid = sub(replaced.center, scale(side.normal, dot(sub(replaced.center, midPlanePoint), side.normal)));
    const axisPoint = sub(onMid, scale(replaced.normal, radius));
    // Material between the sides from the axis plane outward past the face is removed, then the cylinder put back.
    const slab = own(drawRectangle(2 * radius, 2 * reach).sketchOnPlane(own(new Plane(axisPoint, side.normal, replaced.normal))).extrude(reach) as Shape3D);
    const cylinder = own(makeCylinder(radius, 2 * reach, sub(axisPoint, scale(along, reach)), along));
    const blend = own(cylinder.intersect(body));
    result = own(own(result.cut(slab)).fuse(blend));
  }
  return result;
}
