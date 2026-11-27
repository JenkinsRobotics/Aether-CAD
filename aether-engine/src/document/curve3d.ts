import { arc3dGeometry, solve3DConstraints, type Constraint3D } from "../sketch/solver3d/solve3d";

/** A 3D sketch (SolidCraft's sketch.line3d / arc3d / spline3d / point3d, moved with
 *  move3d, optionally constrained by 3D constraints): world-space points joined by straight
 *  segments, a 3-point circular arc, one smooth spline, or a lone point. */
export type V3 = [number, number, number];
export interface Curve3DFeature {
  id: string;
  type: "curve3d";
  name: string;
  suppressed: boolean;
  /** Straight segments end to end, a 3-point circular arc, a smooth spline, or a lone point. */
  kind: "line" | "arc" | "spline" | "point";
  pointsMillimeters: V3[];
  /** Optional 3D sketch constraints solved automatically on validation and edits. */
  constraints?: Constraint3D[];
}
const finite3 = (p: unknown): p is V3 => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number" && Number.isFinite(n));
export function validateCurve3D(feature: Curve3DFeature): void {
  if (!["line", "arc", "spline", "point"].includes(feature.kind)) throw new Error("A 3D sketch is lines, an arc, a spline or a point.");
  if (!Array.isArray(feature.pointsMillimeters) || !feature.pointsMillimeters.every(finite3)) throw new Error("3D sketch points must be finite [x, y, z] millimetres.");
  const needed = feature.kind === "point" ? 1 : feature.kind === "arc" ? 3 : 2;
  if (feature.pointsMillimeters.length < needed) throw new Error(feature.kind === "point" ? "A 3D point needs one point." : feature.kind === "arc" ? "A 3D arc needs exactly three non-collinear points." : "A 3D curve needs two or more points.");
  if (feature.kind === "point" && feature.pointsMillimeters.length !== 1) throw new Error("A 3D point is one point; use lines for several.");
  if (feature.kind === "arc" && feature.pointsMillimeters.length !== 3) throw new Error("A 3D arc needs exactly three points [start, through, end].");
  for (let i = 1; i < feature.pointsMillimeters.length; i++) {
    const [a, b] = [feature.pointsMillimeters[i - 1], feature.pointsMillimeters[i]];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6) throw new Error("Consecutive 3D sketch points must be distinct.");
  }
  if (feature.kind === "arc") {
    arc3dGeometry(feature.pointsMillimeters[0], feature.pointsMillimeters[1], feature.pointsMillimeters[2]);
  }
  if (feature.constraints?.length) {
    solve3DConstraints(feature.pointsMillimeters, feature.constraints);
  }
}
function sampleArc3D(points: V3[], segments = 32): V3[] {
  const { center, radius, u, v, sweep } = arc3dGeometry(points[0], points[1], points[2]);
  const out: V3[] = [];
  for (let i = 0; i <= segments; i++) {
    const ang = (sweep * i) / segments;
    const c = Math.cos(ang), s = Math.sin(ang);
    out.push([
      center[0] + radius * (c * u[0] + s * v[0]),
      center[1] + radius * (c * u[1] + s * v[1]),
      center[2] + radius * (c * u[2] + s * v[2]),
    ]);
  }
  return out;
}
/** Catmull-Rom through the points: what the viewer draws for a spline, close to the
 *  engine's interpolating B-spline (cosmetic only; the engine builds the real curve). */
function catmullRom(points: V3[], perSpan = 12): V3[] {
  if (points.length < 3) return points;
  const out: V3[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)];
    for (let s = 1; s <= perSpan; s++) {
      const t = s / perSpan, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as V3);
    }
  }
  return out;
}
/** World polylines to draw: the segments, a sampled arc or spline, or a small cross for a point. */
export function curve3dPolylines(feature: Curve3DFeature): V3[][] {
  const points = feature.pointsMillimeters;
  if (feature.kind === "point") { const [x, y, z] = points[0], r = 1.5; return [[[x - r, y, z], [x + r, y, z]], [[x, y - r, z], [x, y + r, z]], [[x, y, z - r], [x, y, z + r]]]; }
  if (feature.kind === "arc") return [sampleArc3D(points)];
  return [feature.kind === "spline" ? catmullRom(points) : points];
}
/** Move one point (sketch.move3d): to a position or by an offset. Solves 3D constraints if present. */
export function moveCurve3DPoint(feature: Curve3DFeature, index: number, move: { to: V3 } | { by: V3 }): Curve3DFeature {
  const points = feature.pointsMillimeters.map((p) => [...p] as V3);
  const current = points[index];
  if (!current) throw new Error(`No point ${index} in ${feature.name}.`);
  points[index] = "to" in move ? [...move.to] : [current[0] + move.by[0], current[1] + move.by[1], current[2] + move.by[2]];
  const solvedPoints = feature.constraints?.length ? solve3DConstraints(points, feature.constraints).points : points;
  const next = { ...feature, pointsMillimeters: solvedPoints };
  validateCurve3D(next);
  return next;
}
export { arc3dGeometry, solve3DConstraints, type Constraint3D, type Constraint3DKind, type Solve3DReport } from "../sketch/solver3d/solve3d";
