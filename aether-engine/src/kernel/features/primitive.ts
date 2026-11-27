/** Exact OpenCASCADE direct 3D primitive solid builder (`solid.box`, `cylinder`, `sphere`, `cone`, `torus`). */
import { cast, getOC, isShape3D, makeFace, makeLine, assembleWire, type Shape3D } from "replicad";
import type { PrimitiveFeature } from "../../document/primitive";
import { add, cross, scale, unit, type V3 } from "../vector";

function resolveAxes(feature: PrimitiveFeature): { origin: V3; zDir: V3; xDir: V3 } {
  const origin: V3 = feature.originMillimeters ? [...feature.originMillimeters] as V3 : [0, 0, 0];
  let zDir: V3 = [0, 0, 1];
  if (feature.direction) zDir = unit(feature.direction as V3);
  else if (feature.axis === "X") zDir = [1, 0, 0];
  else if (feature.axis === "Y") zDir = [0, 1, 0];
  const ref: V3 = Math.abs(zDir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const xDir = unit(cross(ref, zDir));
  return { origin, zDir, xDir };
}

/** Builds a new exact OCCT Shape3D for a direct PrimitiveFeature. Caller takes ownership. */
export function buildPrimitiveShape(feature: PrimitiveFeature): Shape3D {
  const oc = getOC();
  const { origin, zDir, xDir } = resolveAxes(feature);
  const yDir = unit(cross(zDir, xDir));

  const makeAx2 = (o: V3) => {
    const p = new oc.gp_Pnt_3(o[0], o[1], o[2]);
    const dz = new oc.gp_Dir_4(zDir[0], zDir[1], zDir[2]);
    const dx = new oc.gp_Dir_4(xDir[0], xDir[1], xDir[2]);
    try {
      return new oc.gp_Ax2_2(p, dz, dx);
    } finally {
      p.delete(); dz.delete(); dx.delete();
    }
  };

  if (feature.kind === "box") {
    const w = feature.widthMillimeters!, d = feature.depthMillimeters!, h = feature.heightMillimeters!;
    const centered = feature.centered !== false;
    const corner = centered
      ? add(add(add(origin, scale(xDir, -w / 2)), scale(yDir, -d / 2)), scale(zDir, -h / 2))
      : origin;
    const ax2 = makeAx2(corner);
    const maker = new oc.BRepPrimAPI_MakeBox_5(ax2, w, d, h);
    try {
      const shape = cast(maker.Shape());
      if (!isShape3D(shape)) throw new Error("Box primitive failed to build a solid.");
      return shape;
    } finally {
      maker.delete(); ax2.delete();
    }
  }

  if (feature.kind === "cylinder") {
    const r = feature.radiusMillimeters!, h = feature.heightMillimeters!;
    const ax2 = makeAx2(origin);
    const maker = new oc.BRepPrimAPI_MakeCylinder_3(ax2, r, h);
    try {
      const shape = cast(maker.Shape());
      if (!isShape3D(shape)) throw new Error("Cylinder primitive failed to build a solid.");
      return shape;
    } finally {
      maker.delete(); ax2.delete();
    }
  }

  if (feature.kind === "sphere") {
    const r = feature.radiusMillimeters!;
    const ax2 = makeAx2(origin);
    const maker = new oc.BRepPrimAPI_MakeSphere_9(ax2, r);
    try {
      const shape = cast(maker.Shape());
      if (!isShape3D(shape)) throw new Error("Sphere primitive failed to build a solid.");
      return shape;
    } finally {
      maker.delete(); ax2.delete();
    }
  }

  if (feature.kind === "torus") {
    const rMaj = feature.majorRadiusMillimeters!, rMin = feature.minorRadiusMillimeters!;
    const ax2 = makeAx2(origin);
    const maker = new oc.BRepPrimAPI_MakeTorus_5(ax2, rMaj, rMin);
    try {
      const shape = cast(maker.Shape());
      if (!isShape3D(shape)) throw new Error("Torus primitive failed to build a solid.");
      return shape;
    } finally {
      maker.delete(); ax2.delete();
    }
  }

  // Exact analytic cone / frustum via 2π revolution of a right triangle / trapezoid face.
  const r0 = feature.bottomRadiusMillimeters ?? 0;
  const r1 = feature.topRadiusMillimeters ?? 0;
  const h = feature.heightMillimeters!;
  const p0 = origin;
  const p1 = add(origin, scale(xDir, r0));
  const p2 = add(add(origin, scale(zDir, h)), scale(xDir, r1));
  const p3 = add(origin, scale(zDir, h));
  const pts: V3[] = r0 > 1e-9 && r1 > 1e-9 ? [p0, p1, p2, p3] : r0 > 1e-9 ? [p0, p1, p3] : [p0, p2, p3];
  const edges = pts.map((a, i) => makeLine(a, pts[(i + 1) % pts.length]));
  const wire = assembleWire(edges);
  const face = makeFace(wire);
  const pAx = new oc.gp_Pnt_3(origin[0], origin[1], origin[2]);
  const dAx = new oc.gp_Dir_4(zDir[0], zDir[1], zDir[2]);
  const ax1 = new oc.gp_Ax1_2(pAx, dAx);
  const revol = new oc.BRepPrimAPI_MakeRevol_1(face.wrapped, ax1, Math.PI * 2, true);
  try {
    const shape = cast(revol.Shape());
    if (!isShape3D(shape)) throw new Error("Cone primitive failed to build a solid.");
    return shape;
  } finally {
    revol.delete(); ax1.delete(); dAx.delete(); pAx.delete();
    face.delete(); wire.delete(); edges.forEach((e) => e.delete());
  }
}
