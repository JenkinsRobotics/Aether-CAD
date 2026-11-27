import {
  basicFaceExtrusion,
  isShape3D,
  makeCylinder,
  makeFace,
  measureVolume,
  Vector,
  type Face,
  type Shape3D,
  type Wire,
} from "replicad";
import { deleteAfterVectorTuple } from "../../geometry/index";
import type { EmbossFeature } from "../../document/emboss";
import { add, dot, neg, scale, sub, unit, type V3 } from "../vector";

export interface EmbossContext {
  body: Shape3D;
  face: Face;
  wire: Wire;
  wirePlaneNormal: V3;
  wirePlaneOrigin: V3;
  cylinder?: { at: V3; along: V3; radius: number };
  own: <T>(value: T) => T;
}

/** Evaluates Wrap & Emboss onto a planar or cylindrical face.
 *  - Planar face: translates the closed sketch wire onto the face plane, extrudes outward (emboss)
 *    or inward (deboss) with a tiny overlap for exact Boolean soundness, and fuses/cuts with the host body.
 *  - Cylindrical face: extrudes radially through the cylinder surface, trimmed by two coaxial
 *    cylinders `[R, R + depth]` (emboss) or `[R - depth, R]` (deboss), producing a true constant-depth
 *    cylindrical wrap! */
export function applyEmbossFeature(feature: EmbossFeature, context: EmbossContext): Shape3D {
  const { body, face, wire, wirePlaneOrigin, cylinder, own } = context;
  const depth = feature.depthMillimeters;
  const isDeboss = feature.mode === "deboss";

  if (face.geomType === "PLANE") {
    const faceCenter = deleteAfterVectorTuple(face.center) as V3;
    const outward = unit(deleteAfterVectorTuple(face.normalAt(faceCenter)) as V3);
    // Project sketch wire cleanly onto the target face plane along the face normal.
    const delta = dot(sub(faceCenter, wirePlaneOrigin), outward);
    const placedWire = Math.abs(delta) > 1e-7 ? own(wire.clone().translate(scale(outward, delta))) : wire;
    const baseFace = own(makeFace(placedWire));
    // Add a small root overlap (0.05 mm) into the host solid for watertight boolean fusion/cut.
    const overlap = Math.min(0.05, depth * 0.25);
    const startShift = isDeboss ? scale(outward, overlap) : scale(outward, -overlap);
    const shiftedFace = own(baseFace.clone().translate(startShift));
    const extrudeDir = isDeboss ? neg(outward) : outward;
    const sweepVec = new Vector(scale(extrudeDir, depth + overlap));
    let prism: Shape3D;
    try {
      prism = own(basicFaceExtrusion(shiftedFace, sweepVec));
    } finally {
      sweepVec.delete();
    }
    const result = isDeboss ? body.cut(prism) : body.fuse(prism);
    if (!isShape3D(result)) throw new Error("Emboss failed to modify the target body.");
    return own(result);
  }

  if (cylinder) {
    // Cylindrical emboss/deboss: extrude the sketch profile across the cylindrical wall and intersect
    // with the exact cylindrical annular shell [R, R + depth] (emboss) or [R - depth, R] (deboss).
    const { at, along, radius } = cylinder;
    const overlap = Math.min(0.05, depth * 0.25);
    const baseFace = own(makeFace(wire));
    const radialDir = unit(sub(wirePlaneOrigin, add(at, scale(along, dot(sub(wirePlaneOrigin, at), along)))));
    const span = radius * 2.5 + depth * 2;
    const startFace = own(baseFace.clone().translate(scale(radialDir, -span * 0.5)));
    const sweepVec = new Vector(scale(radialDir, span));
    let rawPrism: Shape3D;
    try {
      rawPrism = own(basicFaceExtrusion(startFace, sweepVec));
    } finally {
      sweepVec.delete();
    }
    const bounds = body.boundingBox.bounds;
    const cylHeight = Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]) + 20;
    const cylStart = add(at, scale(along, -cylHeight * 0.5));
    const rInner = isDeboss ? Math.max(1e-3, radius - depth) : Math.max(1e-3, radius - overlap);
    const rOuter = isDeboss ? radius + overlap : radius + depth;
    const outerCyl = own(makeCylinder(rOuter, cylHeight, cylStart, along));
    const innerCyl = own(makeCylinder(rInner, cylHeight + 2, add(cylStart, scale(along, -1)), along));
    const shell = own(outerCyl.cut(innerCyl));
    const wrapped = own(rawPrism.intersect(shell));
    if (!isShape3D(wrapped) || measureVolume(wrapped) < 1e-9) {
      throw new Error("Emboss profile does not intersect the target cylindrical face.");
    }
    const result = isDeboss ? body.cut(wrapped) : body.fuse(wrapped);
    if (!isShape3D(result)) throw new Error("Cylindrical emboss failed to modify the target body.");
    return own(result);
  }

  throw new Error("Emboss currently supports planar and cylindrical faces.");
}
