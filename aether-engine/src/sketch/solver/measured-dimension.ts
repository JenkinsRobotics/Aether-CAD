import { lineLineMeasurement } from "./line-line-measurement";
import { referencedConic } from '../reference/conic-constraints';
import type { SketchDrawing } from "../drawing";
import type { DrawingConstraint } from "./types";
import { resolve } from "./entities";
import { pointLineMeasurement } from "./point-line-measurement";
export const referenceDimensionKinds = [
  "length",
  "distance",
  "horizontal-distance",
  "vertical-distance",
  "radius",
  "diameter",
  "arc-length",
  "arc-sweep",
  "line-angle",
  "linear-diameter",
  "point-circle-distance",
  "line-circle-distance",
  "circle-circle-distance",
  "slot-overall-length",
  "angle",
  "conic-rho",
] as const;
/** Reference dimensions measure current geometry, never provide equations. */
export function measuredDimensionValue(
  d: SketchDrawing,
  c: DrawingConstraint,
): number {
  if (
    c.value !== undefined ||
    c.valueFrom !== undefined ||
    c.valueSign !== undefined ||
    c.valueScale !== undefined ||
    c.valueOffset !== undefined
  )
    throw Error("Reference dimensions cannot contain driving values or links.");
  if (c.kind === 'conic-rho') return referencedConic(d,c.a).rho;
  const a = resolve(d, c.a),
    b = c.b ? resolve(d, c.b) : undefined;
  if ((c.kind === "radius" || c.kind === "diameter") && a.circle)
    return a.circle.radius * (c.kind === "diameter" ? 2 : 1);
  if (c.kind === "arc-length" && a.arc)
    return a.arc.radius * Math.abs(a.arc.sweep);
  if (c.kind === "arc-sweep" && a.arc)
    return (Math.abs(a.arc.sweep) * 180) / Math.PI;
  if (c.kind === "line-angle" && a.line) {
    const dx = a.line[1][0] - a.line[0][0], dy = a.line[1][1] - a.line[0][1];
    if (Math.hypot(dx, dy) < 1e-10) throw Error("Cannot measure a zero-length line angle.");
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }
  if (c.kind === "linear-diameter") {
    const p = a.point ?? b?.point, l = a.line ?? b?.line;
    if (p && l) return 2 * pointLineMeasurement(p, l).distance;
  }
  if (c.kind === "point-circle-distance") {
    const p = a.point ?? b?.point, circ = a.circle ?? b?.circle;
    if (p && circ) {
      const centerDist = Math.hypot(p[0] - circ.center[0], p[1] - circ.center[1]);
      return c.gapMode === "inner" ? circ.radius - centerDist : centerDist - circ.radius;
    }
  }
  if (c.kind === "line-circle-distance") {
    const l = a.line ?? b?.line, circ = a.circle ?? b?.circle;
    if (l && circ) {
      const dLine = pointLineMeasurement(circ.center, l).distance;
      return c.gapMode === "inner" ? dLine + circ.radius : dLine - circ.radius;
    }
  }
  if (c.kind === "circle-circle-distance" && a.circle && b?.circle) {
    const centerDist = Math.hypot(a.circle.center[0] - b.circle.center[0], a.circle.center[1] - b.circle.center[1]);
    return c.gapMode === "nested"
      ? Math.abs(a.circle.radius - b.circle.radius) - centerDist
      : c.gapMode === "inner"
        ? centerDist + a.circle.radius + b.circle.radius
        : centerDist - (a.circle.radius + b.circle.radius);
  }
  if (c.kind === "slot-overall-length" && a.circle && b?.circle) {
    return Math.hypot(a.circle.center[0] - b.circle.center[0], a.circle.center[1] - b.circle.center[1]) + a.circle.radius + b.circle.radius;
  }
  if (c.kind === "length" && a.line)
    return Math.hypot(a.line[1][0] - a.line[0][0], a.line[1][1] - a.line[0][1]);
  if (a.point && b?.point) {
    const dx = b.point[0] - a.point[0],
      dy = b.point[1] - a.point[1];
    if (c.kind === "distance") return Math.hypot(dx, dy);
    if (c.kind === "horizontal-distance") return dx;
    if (c.kind === "vertical-distance") return dy;
  }
  if (c.kind === "distance") {
    if (a.line && b?.line) {
      const m = lineLineMeasurement(a.line, b.line);
      if (Math.abs(m.parallelError) > 1e-7)
        throw Error("Reference line distance requires parallel lines.");
      return m.distance;
    }
    if (a.point && b?.line)
      return pointLineMeasurement(a.point, b.line).distance;
    if (a.line && b?.point)
      return pointLineMeasurement(b.point, a.line).distance;
  }
  if (c.kind === "angle" && a.line && b?.line) {
    const u = [a.line[1][0] - a.line[0][0], a.line[1][1] - a.line[0][1]],
      v = [b.line[1][0] - b.line[0][0], b.line[1][1] - b.line[0][1]];
    if (Math.hypot(...u) < 1e-10 || Math.hypot(...v) < 1e-10)
      throw Error("Cannot measure a zero-length line angle.");
    return (
      (Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180) /
      Math.PI
    );
  }
  throw Error("Select compatible geometry for a reference dimension.");
}
