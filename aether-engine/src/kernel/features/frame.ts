import {
  basicFaceExtrusion,
  draw,
  drawCircle,
  isShape3D,
  makeCompound,
  makeVertex,
  measureDistanceBetween,
  measureVolume,
  Plane,
  Vector,
  type Shape3D,
} from "replicad";
import {
  resolveFrameProfile,
  type FrameEndCapFeature,
  type FrameGussetFeature,
  type FrameMemberFeature,
  type FrameProfileSpec,
} from "../../document/frame";
import type { V3 } from "../../document/curve3d";
import { add, cross, dot, neg, norm, scale, sub, unit } from "../vector";
import { offsetSolid } from "./boolean";

function perpAxes(dir: V3, rotationDegrees: number): { x: V3; y: V3 } {
  const ref: V3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x0 = unit(cross(ref, dir));
  const y0 = unit(cross(dir, x0));
  if (Math.abs(rotationDegrees) < 1e-9) return { x: x0, y: y0 };
  const rad = (rotationDegrees * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return {
    x: [c * x0[0] + s * y0[0], c * x0[1] + s * y0[1], c * x0[2] + s * y0[2]],
    y: [-s * x0[0] + c * y0[0], -s * x0[1] + c * y0[1], -s * x0[2] + c * y0[2]],
  };
}

function buildSectionPrism(
  spec: FrameProfileSpec,
  origin: V3,
  dir: V3,
  length: number,
  rotationDegrees: number,
  ox: number,
  oy: number,
  own: <T>(v: T) => T,
): Shape3D {
  const { x } = perpAxes(dir, rotationDegrees);
  const plane = own(new Plane(origin, x, dir));
  const w = spec.widthMillimeters, h = spec.heightMillimeters;
  const hw = w / 2, hh = h / 2;
  const extrudeDrawing = (drawing: import("replicad").Drawing) => {
    const sk = own(drawing.sketchOnPlane(plane)) as import("replicad").Sketch;
    const face = own(sk.face());
    const vec = new Vector(scale(dir, length));
    try {
      return own(basicFaceExtrusion(face, vec));
    } finally {
      vec.delete();
    }
  };

  if (spec.kind === "round-bar") {
    return extrudeDrawing(drawCircle(hw).translate(ox, oy));
  }
  if (spec.kind === "round-tube") {
    const t = spec.wallMillimeters!;
    const outer = extrudeDrawing(drawCircle(hw).translate(ox, oy));
    const inner = extrudeDrawing(drawCircle(hw - t).translate(ox, oy));
    const tube = outer.cut(inner);
    if (!isShape3D(tube)) throw new Error("Failed to hollow round tube profile.");
    return own(tube);
  }
  if (spec.kind === "bar") {
    return extrudeDrawing(
      draw([ox - hw, oy - hh]).lineTo([ox + hw, oy - hh]).lineTo([ox + hw, oy + hh]).lineTo([ox - hw, oy + hh]).close(),
    );
  }
  if (spec.kind === "rect-tube") {
    const t = spec.wallMillimeters!;
    const outer = extrudeDrawing(
      draw([ox - hw, oy - hh]).lineTo([ox + hw, oy - hh]).lineTo([ox + hw, oy + hh]).lineTo([ox - hw, oy + hh]).close(),
    );
    const iw = hw - t, ih = hh - t;
    const inner = extrudeDrawing(
      draw([ox - iw, oy - ih]).lineTo([ox + iw, oy - ih]).lineTo([ox + iw, oy + ih]).lineTo([ox - iw, oy + ih]).close(),
    );
    const tube = outer.cut(inner);
    if (!isShape3D(tube)) throw new Error("Failed to hollow rectangular tube profile.");
    return own(tube);
  }
  if (spec.kind === "angle") {
    const t = spec.wallMillimeters!;
    return extrudeDrawing(
      draw([ox - hw, oy - hh])
        .lineTo([ox + hw, oy - hh])
        .lineTo([ox + hw, oy - hh + t])
        .lineTo([ox - hw + t, oy - hh + t])
        .lineTo([ox - hw + t, oy + hh])
        .lineTo([ox - hw, oy + hh])
        .close(),
    );
  }
  if (spec.kind === "channel") {
    const web = spec.webMillimeters ?? spec.wallMillimeters ?? Math.min(w, h) * 0.1;
    const fl = spec.flangeMillimeters ?? spec.wallMillimeters ?? Math.min(w, h) * 0.12;
    return extrudeDrawing(
      draw([ox - hw, oy - hh])
        .lineTo([ox + hw, oy - hh])
        .lineTo([ox + hw, oy - hh + fl])
        .lineTo([ox - hw + web, oy - hh + fl])
        .lineTo([ox - hw + web, oy + hh - fl])
        .lineTo([ox + hw, oy + hh - fl])
        .lineTo([ox + hw, oy + hh])
        .lineTo([ox - hw, oy + hh])
        .close(),
    );
  }
  // i-beam
  const web = spec.webMillimeters ?? Math.min(w, h) * 0.08;
  const fl = spec.flangeMillimeters ?? Math.min(w, h) * 0.1;
  const hweb = web / 2;
  return extrudeDrawing(
    draw([ox - hw, oy - hh])
      .lineTo([ox + hw, oy - hh])
      .lineTo([ox + hw, oy - hh + fl])
      .lineTo([ox + hweb, oy - hh + fl])
      .lineTo([ox + hweb, oy + hh - fl])
      .lineTo([ox + hw, oy + hh - fl])
      .lineTo([ox + hw, oy + hh])
      .lineTo([ox - hw, oy + hh])
      .lineTo([ox - hw, oy + hh - fl])
      .lineTo([ox - hweb, oy + hh - fl])
      .lineTo([ox - hweb, oy - hh + fl])
      .lineTo([ox - hw, oy - hh + fl])
      .close(),
  );
}

/** Build structural frame member(s) from path segments, applying optional weld gap and corner trim. */
export function buildFrameMembers(
  feature: FrameMemberFeature,
  segments: [V3, V3][],
  own: <T>(v: T) => T,
): Shape3D {
  if (!segments.length) throw new Error("Frame member has no straight segments to sweep.");
  const spec = resolveFrameProfile(feature);
  const rot = feature.rotationDegrees ?? 0;
  const ox = feature.offsetXMillimeters ?? 0;
  const oy = feature.offsetYMillimeters ?? 0;
  const gap = feature.weldGapMillimeters ?? 0;

  const solids: Shape3D[] = [];
  for (const [start, end] of segments) {
    const rawVec = sub(end, start);
    const totalLen = norm(rawVec);
    if (totalLen <= gap + 1e-4) throw new Error("Frame segment is shorter than weld gap.");
    const dir = unit(rawVec);
    const trimmedStart = gap > 0 ? add(start, scale(dir, gap / 2)) : start;
    const trimmedLen = totalLen - gap;
    solids.push(buildSectionPrism(spec, trimmedStart, dir, trimmedLen, rot, ox, oy, own));
  }
  if (solids.length === 1) return solids[0];
  // Fuse touching members if miter/butt requested, otherwise compound.
  if (feature.trimMode === "miter" || feature.trimMode === "butt") {
    let acc = solids[0];
    for (let i = 1; i < solids.length; i++) {
      const fused = acc.fuse(solids[i]);
      acc = isShape3D(fused) ? own(fused) : acc;
    }
    return acc;
  }
  return own(makeCompound(solids) as unknown as Shape3D);
}

/** Build frame end cap plate(s) at the start and/or end of a frame member's segments. */
export function buildFrameEndCaps(
  cap: FrameEndCapFeature,
  member: FrameMemberFeature,
  segments: [V3, V3][],
  own: <T>(v: T) => T,
): Shape3D {
  if (!segments.length) throw new Error("Frame end cap target has no segments.");
  const spec = resolveFrameProfile(member);
  const inset = cap.insetMillimeters ?? 0;
  const plateW = Math.max(1e-3, spec.widthMillimeters - 2 * inset);
  const plateH = Math.max(1e-3, spec.heightMillimeters - 2 * inset);
  const capSpec: FrameProfileSpec = {
    ...spec,
    kind: spec.kind === "round-tube" || spec.kind === "round-bar" ? "round-bar" : "bar",
    widthMillimeters: plateW,
    heightMillimeters: plateH,
  };
  const rot = member.rotationDegrees ?? 0;
  const ox = member.offsetXMillimeters ?? 0;
  const oy = member.offsetYMillimeters ?? 0;

  const caps: Shape3D[] = [];
  const first = segments[0], last = segments[segments.length - 1];
  if (cap.end === "start" || cap.end === "both") {
    const dir = unit(sub(first[0], first[1])); // outward from start
    caps.push(buildSectionPrism(capSpec, first[0], dir, cap.thicknessMillimeters, rot, ox, oy, own));
  }
  if (cap.end === "end" || cap.end === "both") {
    const dir = unit(sub(last[1], last[0])); // outward from end
    caps.push(buildSectionPrism(capSpec, last[1], dir, cap.thicknessMillimeters, rot, ox, oy, own));
  }
  return caps.length === 1 ? caps[0] : own(makeCompound(caps) as unknown as Shape3D);
}

function boxCenter(shape: Shape3D): V3 {
  const b = shape.boundingBox.bounds;
  return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2];
}

function boxSpan(shape: Shape3D): number {
  const b = shape.boundingBox.bounds;
  return Math.max(10, Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]));
}

function halfSpaceBox(origin: V3, normal: V3, span: number, own: <T>(v: T) => T): Shape3D {
  const n = unit(normal);
  const { x } = perpAxes(n, 0);
  const plane = own(new Plane(origin, x, n));
  const rect = draw([-span, -span]).lineTo([span, -span]).lineTo([span, span]).lineTo([-span, span]).close();
  const sk = own(rect.sketchOnPlane(plane)) as import("replicad").Sketch;
  const face = own(sk.face());
  const vec = new Vector(scale(n, span * 2));
  try {
    return own(basicFaceExtrusion(face, vec));
  } finally {
    vec.delete();
  }
}

/** Trim a structural member body (`frame.trim`) against a tool body or plane with butt, cope, or miter mode. */
export function trimFrameBody(
  target: Shape3D,
  options: {
    mode: "butt" | "cope" | "miter";
    toolBody?: Shape3D;
    plane?: { origin: V3; normal: V3 };
    keepPoint?: V3;
    weldGapMillimeters?: number;
    solidsOf: (s: Shape3D) => Shape3D[];
    own: <T>(v: T) => T;
  },
): Shape3D {
  const { mode, toolBody, plane, keepPoint, solidsOf, own } = options;
  const gap = options.weldGapMillimeters ?? 0;
  const targetCenter = boxCenter(target);
  const keepPt = keepPoint ?? targetCenter;
  const span = Math.max(boxSpan(target), toolBody ? boxSpan(toolBody) : 10) * 3;

  const choosePiece = (shape: Shape3D): Shape3D => {
    const pieces = solidsOf(shape);
    if (pieces.length <= 1) return shape;
    if (keepPoint) {
      const probe = makeVertex(keepPoint);
      let best = pieces[0], bestDist = Infinity;
      try {
        for (const p of pieces) {
          const d = measureDistanceBetween(probe, p);
          if (d < bestDist) { bestDist = d; best = p; }
        }
      } finally { probe.delete(); }
      return own(best);
    }
    pieces.sort((a, b) => measureVolume(b) - measureVolume(a));
    return own(pieces[0]);
  };

  if (plane) {
    let n = unit(plane.normal);
    // Orient normal toward the discard side (away from keepPt).
    if (dot(sub(keepPt, plane.origin), n) > 0) n = neg(n);
    const shifted = gap > 0 ? add(plane.origin, scale(neg(n), gap)) : plane.origin;
    const cutter = halfSpaceBox(shifted, n, span, own);
    const cut = target.cut(cutter);
    if (!isShape3D(cut) || !(measureVolume(cut) > 1e-9)) throw new Error("Frame trim removed the entire member.");
    return choosePiece(own(cut));
  }

  if (!toolBody) throw new Error("Frame trim needs a tool body or a plane.");

  if (mode === "cope") {
    const cutter = gap > 0 ? own(offsetSolid(toolBody, gap)) : toolBody;
    const cut = target.cut(cutter);
    if (!isShape3D(cut) || !(measureVolume(cut) > 1e-9)) throw new Error("Cope trim removed the entire member.");
    return choosePiece(own(cut));
  }

  const toolCenter = boxCenter(toolBody);
  if (mode === "miter") {
    // Bisector plane through the overlap centroid separating target from toolBody.
    const common = target.intersect(toolBody);
    const pivot = isShape3D(common) && measureVolume(common) > 1e-9 ? boxCenter(common) : scale(add(targetCenter, toolCenter), 0.5);
    if (isShape3D(common)) own(common);
    const dirA = unit(sub(targetCenter, pivot));
    const dirB = unit(sub(toolCenter, pivot));
    // Normal pointing from target side toward tool side along the angle bisector.
    const diff = sub(dirB, dirA);
    const normal = norm(diff) > 1e-6 ? unit(diff) : unit(sub(toolCenter, targetCenter));
    const shifted = gap > 0 ? add(pivot, scale(neg(normal), gap / 2)) : pivot;
    const cutter = halfSpaceBox(shifted, normal, span, own);
    const cut = target.cut(cutter);
    if (!isShape3D(cut) || !(measureVolume(cut) > 1e-9)) throw new Error("Miter trim removed the entire member.");
    return choosePiece(own(cut));
  }

  // Butt trim: find the planar face on toolBody closest to targetCenter whose outward normal faces target.
  const faces = toolBody.faces;
  let bestFaceOrigin: V3 | null = null;
  let bestFaceNormal: V3 | null = null;
  let bestScore = Infinity;
  const toTarget = unit(sub(targetCenter, toolCenter));
  for (const f of faces) {
    if (f.geomType === "PLANE") {
      const c = f.center;
      const nv = f.normalAt(c);
      const fc: V3 = [c.x, c.y, c.z];
      const fn = unit([nv.x, nv.y, nv.z]);
      c.delete();
      nv.delete();
      const align = dot(fn, toTarget);
      if (align > 0.3) {
        const d = norm(sub(targetCenter, fc)) / align;
        if (d < bestScore) {
          bestScore = d;
          bestFaceOrigin = fc;
          bestFaceNormal = fn;
        }
      }
    }
    f.delete();
  }

  if (bestFaceOrigin && bestFaceNormal) {
    // Discard side is into the toolBody (-bestFaceNormal), shifted outward by weld gap.
    const discardDir = neg(bestFaceNormal);
    const shifted = gap > 0 ? add(bestFaceOrigin, scale(bestFaceNormal, gap)) : bestFaceOrigin;
    const cutter = halfSpaceBox(shifted, discardDir, span, own);
    const cut = target.cut(cutter);
    if (!isShape3D(cut) || !(measureVolume(cut) > 1e-9)) throw new Error("Butt trim removed the entire member.");
    return choosePiece(own(cut));
  }

  // Fallback for cylindrical tool bodies: cope cut.
  const cutter = gap > 0 ? own(offsetSolid(toolBody, gap)) : toolBody;
  const cut = target.cut(cutter);
  if (!isShape3D(cut) || !(measureVolume(cut) > 1e-9)) throw new Error("Butt trim removed the entire member.");
  return choosePiece(own(cut));
}

/** Build a structural corner gusset plate (`frame.gusset`) centered on the plane of axisA and axisB. */
export function buildFrameGusset(feature: FrameGussetFeature, own: <T>(v: T) => T): Shape3D {
  const u = unit(feature.axisA);
  const bRaw = unit(feature.axisB);
  const n = unit(cross(u, bRaw));
  const v = unit(cross(n, u));
  const b2: [number, number] = [dot(bRaw, u), dot(bRaw, v)];
  const legA = feature.legAMillimeters;
  const legB = feature.legBMillimeters;
  const c = feature.chamferMillimeters ?? 0;

  const pA: [number, number] = [legA, 0];
  const pB: [number, number] = [b2[0] * legB, b2[1] * legB];
  const pen = c > 1e-6 ? draw([c, 0]) : draw([0, 0]);
  pen.lineTo(pA);
  if (feature.shape === "polygon") {
    // Chamfered 5-sided plate: short perpendicular tabs along each leg.
    const tabA: [number, number] = [pA[0] + b2[0] * (legB * 0.25), pA[1] + b2[1] * (legB * 0.25)];
    const tabB: [number, number] = [pB[0] + legA * 0.25, pB[1]];
    pen.lineTo(tabA);
    pen.lineTo(tabB);
  }
  pen.lineTo(pB);
  if (c > 1e-6) pen.lineTo([b2[0] * c, b2[1] * c]);
  const profile = own(pen.close());

  const startOrigin = add(feature.originMillimeters, scale(n, -feature.thicknessMillimeters / 2));
  const plane = own(new Plane(startOrigin, u, n));
  const sk = own(profile.sketchOnPlane(plane)) as import("replicad").Sketch;
  const face = own(sk.face());
  const vec = new Vector(scale(n, feature.thicknessMillimeters));
  try {
    const solid = own(basicFaceExtrusion(face, vec));
    if (!isShape3D(solid) || !(measureVolume(solid) > 1e-9)) throw new Error("Frame gusset produced no solid.");
    return solid;
  } finally {
    vec.delete();
  }
}
