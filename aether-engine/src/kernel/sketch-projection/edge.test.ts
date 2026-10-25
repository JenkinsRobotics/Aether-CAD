import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeBezierCurve, makeBSplineApproximation, makeCircle, makeEllipse, makeEllipseArc, makeLine, type Edge } from "replicad";
import { initNodeKernel } from "../node-kernel";
import { principalFrame } from "../../document/construction-planes";
import { segmentPoint, ellipseFrame } from "../../sketch/curves/parameterization";
import { validateSketchDrawing, type SketchContour, type SketchPoint, type SketchFrame } from "../../sketch/drawing";
import { projectModelEdge } from "./edge";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);
const xy = principalFrame("XY", 27);
function project(edge: Edge, frame = xy, tolerance = 0.01) {
  try {
    const result = projectModelEdge(edge, frame, tolerance);
    validateSketchDrawing({ type: "drawing", contours: [result.contour] });
    return result;
  } finally { edge.delete(); }
}
function samples(contour: SketchContour): SketchPoint[] {
  if (contour.type === "circle") return Array.from({ length: 101 }, (_, i) => [contour.center[0] + contour.radius * Math.cos(i * Math.PI / 50), contour.center[1] + contour.radius * Math.sin(i * Math.PI / 50)]);
  let start = contour.start;
  return [start, ...contour.segments.flatMap(segment => {
    const points = Array.from({ length: 101 }, (_, i) => segmentPoint(start, segment, i / 100));
    start = segment.end;
    return points;
  })];
}
it("projects translated lines and preserves normal-aligned edges as point nodes", () => {
  expect(project(makeLine([2, 3, 10], [9, 8, 16]))).toEqual({ contour: { type: "path", start: [2, 3], segments: [{ type: "line", end: [9, 8] }] }, approximated: false });
  expect(project(makeLine([2, 3, 10], [2, 3, 16])).contour).toEqual({ type: "path", start: [2, 3], segments: [] });
});
it("preserves displaced circles exactly, including when the target normal is reversed", () => {
  for (const normal of [[0, 0, 1], [0, 0, -1]] as [number, number, number][]) {
    const frame: SketchFrame = { originMillimeters: [1, 1, 27], xDirection: [1, 0, 0], normal };
    const result = project(makeCircle(5, [3, 2, 10]), frame);
    expect(result.approximated).toBe(false);
    expect(result.contour).toEqual({ type: "circle", center: [2, normal[2]], radius: 5 });
  }
});
it("projects a tilted circle as an exact ellipse and an edge-on circle as its full diameter", () => {
  const tilted = project(makeCircle(5, [3, 2, 10], [0, Math.sqrt(3) / 2, 0.5]));
  expect(tilted.approximated).toBe(false);
  expect(tilted.contour.type).toBe("path");
  if (tilted.contour.type !== "path") throw Error("Expected an ellipse.");
  expect(tilted.contour.segments.map(s => s.type)).toEqual(["ellipse", "ellipse"]);
  for (const [x, y] of samples(tilted.contour)) expect(((x - 3) / 5) ** 2 + ((y - 2) / 2.5) ** 2).toBeCloseTo(1, 6);
  const collapsed = project(makeCircle(5, [3, 2, 10], [0, 1, 0]));
  expect(collapsed.approximated).toBe(false);
  const points = samples(collapsed.contour);
  expect(Math.min(...points.map(p => p[0]))).toBeCloseTo(-2, 7);
  expect(Math.max(...points.map(p => p[0]))).toBeCloseTo(8, 7);
  expect(points.every(p => Math.abs(p[1] - 2) < 1e-7)).toBe(true);
});
it("keeps a rotated ellipse and a greater-than-half elliptic arc analytic", () => {
  const contour = project(makeEllipse(8, 3, [2, 4, 10], [0, 0, 1], [Math.SQRT1_2, Math.SQRT1_2, 0])).contour;
  expect(contour.type).toBe("path");
  if (contour.type !== "path" || contour.segments[0].type !== "ellipse") throw Error("Expected an ellipse.");
  const f = ellipseFrame(contour.start, contour.segments[0]);
  expect(f.radiusX).toBeCloseTo(8, 7); expect(f.radiusY).toBeCloseTo(3, 7);
  expect(f.center[0]).toBeCloseTo(2, 6); expect(f.center[1]).toBeCloseTo(4, 6);
  const arc = project(makeEllipseArc(8, 3, 0.2, 4.7, [2, 4, 10], [0, 0, 1], [1, 0, 0]));
  expect(arc.approximated).toBe(false);
  if (arc.contour.type !== "path" || arc.contour.segments[0].type !== "ellipse") throw Error("Expected an arc.");
  expect(arc.contour.segments[0].largeArc).toBe(true);
  expect(Math.abs(ellipseFrame(arc.contour.start, arc.contour.segments[0]).sweep)).toBeCloseTo(4.5, 6);
});
it("projects nonplanar cubic controls exactly and retains closed loops", () => {
  const result = project(makeBezierCurve([[0, 0, 0], [3, 8, 9], [8, -3, 11], [10, 2, 6]]));
  expect(result).toEqual({ contour: { type: "path", start: [0, 0], segments: [{ type: "bezier", end: [10, 2], controls: [[3, 8], [8, -3]] }] }, approximated: false });
  const loop = project(makeBezierCurve([[0, 0, 0], [8, 9, 4], [-8, 9, 4], [0, 0, 8]]));
  expect(loop.approximated).toBe(false);
  expect(loop.contour.type === "path" && loop.contour.segments.length).toBe(2);
  expect(Math.max(...samples(loop.contour).map(p => p[1]))).toBeCloseTo(6.75, 6);
});
it("reports spline approximation and measures the resulting polyline against independent dense samples", () => {
  const edge = makeBSplineApproximation(Array.from({ length: 9 }, (_, i) => [i * 2, 4 * Math.sin(i), i / 3]));
  try {
    const result = projectModelEdge(edge, xy, 0.01);
    expect(result.approximated).toBe(true);
    if (result.contour.type !== "path") throw Error("Expected a polyline.");
    const points = [result.contour.start, ...result.contour.segments.map(s => s.end)];
    const distance = (p: SketchPoint, a: SketchPoint, b: SketchPoint) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    for (let i = 0; i <= 1000; i++) {
      const p = edge.pointAt(i / 1000);
      try { expect(Math.min(...points.slice(1).map((b, j) => distance([p.x, p.y], points[j], b)))).toBeLessThanOrEqual(0.01001); }
      finally { p.delete(); }
    }
  } finally { edge.delete(); }
});
