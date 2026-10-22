import { expect, it } from "vitest";
import { breakSketchCurveAtIntersections } from "./break";
import type { SketchDrawing } from "../drawing";

it("breaks a line at every crossing in one go, never at its ends", () => {
  // A horizontal line crossed by two verticals and touched at its end by a third.
  const d: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [30, 0] }] },
    { type: "path", start: [10, -5], segments: [{ type: "line", end: [10, 5] }] },
    { type: "path", start: [20, -5], segments: [{ type: "line", end: [20, 5] }] },
    { type: "path", start: [30, -5], segments: [{ type: "line", end: [30, 5] }] },
    { type: "path", start: [0, 20], segments: [{ type: "line", end: [10, 20] }] },
  ] };
  const next = breakSketchCurveAtIntersections(d, [5, 0.1], 1);
  const line = next.contours[0];
  expect(line.type === "path" && line.segments.map((s) => s.end)).toEqual([[10, 0], [20, 0], [30, 0]]);
  expect(next.contours).toHaveLength(5);
  expect(() => breakSketchCurveAtIntersections(d, [5, 20], 1)).toThrow(/No other curve crosses/);
});

it("breaks a line where a circle crosses it", () => {
  const d: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [-20, 0], segments: [{ type: "line", end: [20, 0] }] },
    { type: "circle", center: [0, 0], radius: 5 },
  ] };
  const next = breakSketchCurveAtIntersections(d, [-15, 0], 1);
  const line = next.contours[0];
  const ends = line.type === "path" ? line.segments.map((s) => s.end.map((v) => Math.round(v * 1e6) / 1e6 + 0)) : [];
  expect(ends).toEqual([[-5, 0], [5, 0], [20, 0]]);
});
