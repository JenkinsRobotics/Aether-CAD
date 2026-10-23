/** A 3D sketch (SolidCraft's sketch.line3d / spline3d / point3d, moved with
 *  move3d): world-space points joined by straight segments or one smooth curve,
 *  usable wherever a sketch curve is a path (sweep, pipe, pattern on path).
 *  It makes no body; the viewer draws it like a finished sketch. */
export type V3 = [number, number, number];
export interface Curve3DFeature {
  id: string;
  type: "curve3d";
  name: string;
  suppressed: boolean;
  /** Straight segments end to end, a smooth curve through the points, or a lone point. */
  kind: "line" | "spline" | "point";
  pointsMillimeters: V3[];
}
const finite3 = (p: unknown): p is V3 => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number" && Number.isFinite(n));
export function validateCurve3D(feature: Curve3DFeature): void {
  if (!["line", "spline", "point"].includes(feature.kind)) throw new Error("A 3D sketch is lines, a spline or a point.");
  if (!Array.isArray(feature.pointsMillimeters) || !feature.pointsMillimeters.every(finite3)) throw new Error("3D sketch points must be finite [x, y, z] millimetres.");
  const needed = feature.kind === "point" ? 1 : 2;
  if (feature.pointsMillimeters.length < needed) throw new Error(feature.kind === "point" ? "A 3D point needs one point." : "A 3D curve needs two or more points.");
  if (feature.kind === "point" && feature.pointsMillimeters.length !== 1) throw new Error("A 3D point is one point; use lines for several.");
  for (let i = 1; i < feature.pointsMillimeters.length; i++) {
    const [a, b] = [feature.pointsMillimeters[i - 1], feature.pointsMillimeters[i]];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6) throw new Error("Consecutive 3D sketch points must be distinct.");
  }
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
/** World polylines to draw: the segments, a sampled spline, or a small cross for a point. */
export function curve3dPolylines(feature: Curve3DFeature): V3[][] {
  const points = feature.pointsMillimeters;
  if (feature.kind === "point") { const [x, y, z] = points[0], r = 1.5; return [[[x - r, y, z], [x + r, y, z]], [[x, y - r, z], [x, y + r, z]], [[x, y, z - r], [x, y, z + r]]]; }
  return [feature.kind === "spline" ? catmullRom(points) : points];
}
/** Move one point (sketch.move3d): to a position or by an offset. Points stay joined because they are one list. */
export function moveCurve3DPoint(feature: Curve3DFeature, index: number, move: { to: V3 } | { by: V3 }): Curve3DFeature {
  const points = feature.pointsMillimeters.map((p) => [...p] as V3);
  const current = points[index];
  if (!current) throw new Error(`No point ${index} in ${feature.name}.`);
  points[index] = "to" in move ? [...move.to] : [current[0] + move.by[0], current[1] + move.by[1], current[2] + move.by[2]];
  const next = { ...feature, pointsMillimeters: points };
  validateCurve3D(next);
  return next;
}
