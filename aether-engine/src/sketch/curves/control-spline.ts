import type { SketchContour, SketchPoint } from "../drawing";
import { polynomialBSpline } from "./bspline";

/** Clamped uniform knots for n control points of a degree. */
export function clampedKnots(n: number, degree: number): number[] {
  const inner = n - degree - 1;
  return [...Array(degree + 1).fill(0), ...Array.from({ length: inner }, (_, i) => (i + 1) / (inner + 1)), ...Array(degree + 1).fill(1)];
}
/** A B-spline point by de Boor, and its first derivative from the derivative curve. */
function deBoor(degree: number, knots: readonly number[], controls: readonly SketchPoint[], u: number): SketchPoint {
  let span = degree;
  while (span < controls.length - 1 && u >= knots[span + 1]) span++;
  const d = Array.from({ length: degree + 1 }, (_, j) => [...controls[span - degree + j]] as SketchPoint);
  for (let r = 1; r <= degree; r++)
    for (let j = degree; j >= r; j--) {
      const i = span - degree + j, denominator = knots[i + degree - r + 1] - knots[i];
      const alpha = denominator ? (u - knots[i]) / denominator : 0;
      d[j] = [(1 - alpha) * d[j - 1][0] + alpha * d[j][0], (1 - alpha) * d[j - 1][1] + alpha * d[j][1]];
    }
  return d[degree];
}
function derivative(degree: number, knots: readonly number[], controls: readonly SketchPoint[]): { knots: number[]; controls: SketchPoint[] } {
  const q = controls.slice(0, -1).map((p, i) => { const k = degree / (knots[i + degree + 1] - knots[i + 1] || 1); return [k * (controls[i + 1][0] - p[0]), k * (controls[i + 1][1] - p[1])] as SketchPoint; });
  return { knots: knots.slice(1, -1), controls: q };
}

/** Control-point spline (SolidCraft's sketch.spline.control_point / control_point_5): a clamped
 *  uniform B-spline of degree 3 or 5 through its first and last control points. Degree 3 is
 *  exact (one cubic Bézier per knot span). Degree 5 has no cubic form, so each span is split in
 *  `pieces` (eight) and every piece is the cubic Hermite matching the curve's point and tangent at its
 *  ends: smooth (G1) throughout, within a few micrometres of the true curve for sketch sizes. */
export function controlPointSpline(points: readonly SketchPoint[], degree: 3 | 5, pieces = 8): SketchContour {
  if (points.length < 2) throw new Error("A control-point spline needs two or more points.");
  if (points.length > 500) throw new Error("A control-point spline takes at most 500 points.");
  // Fewer points than the degree needs: lower it, as SolidCraft does.
  const p = Math.min(degree, points.length - 1);
  if (p <= 3) return polynomialBSpline(p, clampedKnots(points.length, p), points);
  const knots = clampedKnots(points.length, p), d1 = derivative(p, knots, points);
  const breaks = [...new Set(knots.slice(p, points.length + 1))];
  const params: number[] = [];
  for (let s = 0; s < breaks.length - 1; s++) for (let k = 0; k < pieces; k++) params.push(breaks[s] + (breaks[s + 1] - breaks[s]) * k / pieces);
  params.push(1);
  const at = (u: number) => ({ point: deBoor(p, knots, points, Math.min(u, 1 - 1e-12)), tangent: deBoor(p - 1, d1.knots, d1.controls, Math.min(u, 1 - 1e-12)) });
  const segments = params.slice(1).map((u, i) => {
    const a = at(params[i]), b = u >= 1 ? { point: points[points.length - 1], tangent: at(1).tangent } : at(u), h = (u - params[i]) / 3;
    return { type: "bezier" as const, controls: [[a.point[0] + a.tangent[0] * h, a.point[1] + a.tangent[1] * h], [b.point[0] - b.tangent[0] * h, b.point[1] - b.tangent[1] * h]] as [SketchPoint, SketchPoint], end: [...b.point] as SketchPoint };
  });
  return { type: "path", start: [...points[0]] as SketchPoint, segments };
}
/** The exact degree-p curve point, for tests and previews. */
export const controlSplinePoint = (points: readonly SketchPoint[], degree: number, u: number) => deBoor(Math.min(degree, points.length - 1), clampedKnots(points.length, Math.min(degree, points.length - 1)), points, Math.min(u, 1 - 1e-12));
