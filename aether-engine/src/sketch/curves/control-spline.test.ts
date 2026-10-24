import { describe, expect, it } from "vitest";
import { controlPointSpline, controlSplinePoint } from "./control-spline";
import type { SketchPoint } from "../drawing";

const bezierAt = (p0: SketchPoint, c: [SketchPoint, SketchPoint], p3: SketchPoint, t: number): SketchPoint => [0, 1].map((k) => (1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * c[0][k] + 3 * (1 - t) * t * t * c[1][k] + t ** 3 * p3[k]) as SketchPoint;
const samples = (contour: ReturnType<typeof controlPointSpline>) => {
  if (contour.type !== "path") throw new Error("path expected");
  let from = contour.start; const out: SketchPoint[] = [];
  for (const s of contour.segments) { if (s.type !== "bezier") throw new Error("bezier expected"); for (let i = 0; i <= 20; i++) out.push(bezierAt(from, s.controls, s.end, i / 20)); from = s.end; }
  return out;
};
const distanceToCurve = (q: SketchPoint, points: SketchPoint[], degree: number) => { let best = Infinity; for (let i = 0; i <= 20000; i++) { const p = controlSplinePoint(points, degree, i / 20000); best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1])); } return best; };

describe("control-point splines", () => {
  const points: SketchPoint[] = [[0, 0], [10, 20], [30, -10], [45, 25], [60, 0], [80, 15], [95, 0]];
  it("degree 5 starts and ends on the end points and stays on the true curve", () => {
    const contour = controlPointSpline(points, 5);
    expect(contour.type === "path" && contour.start).toEqual([0, 0]);
    expect(contour.type === "path" && contour.segments.at(-1)?.end).toEqual([95, 0]);
    for (const q of samples(contour)) expect(distanceToCurve(q, points, 5)).toBeLessThan(0.05);
  });
  it("degree 3 is the exact cubic B-spline", () => {
    for (const q of samples(controlPointSpline(points, 3))) expect(distanceToCurve(q, points, 3)).toBeLessThan(0.05);
  });
  it("lowers the degree for few points and refuses one point", () => {
    expect(controlPointSpline([[0, 0], [10, 0], [10, 10]], 5).type).toBe("path");
    expect(() => controlPointSpline([[0, 0]], 5)).toThrow(/two or more/);
  });
});
