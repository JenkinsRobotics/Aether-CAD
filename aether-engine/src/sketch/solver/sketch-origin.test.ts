import { expect, it } from "vitest";
import { solveDrawingConstraints, constraintResiduals } from "../drawing-constraints";
import { validateSketchDrawing, type SketchDrawing } from "../drawing";
import { SKETCH_ORIGIN_REF } from "./projected-context";

it("binds and dimensions authored points to the fixed sketch origin", () => {
  const d: SketchDrawing = {
    type: "drawing",
    contours: [{ type: "path", start: [3, 4], segments: [{ type: "line", end: [20, 9] }] }],
    constraints: [
      { id: "on", kind: "coincident", a: { contour: 0, kind: "point", index: 0 }, b: SKETCH_ORIGIN_REF },
      { id: "far", kind: "distance", a: { contour: 0, kind: "point", index: 1 }, b: SKETCH_ORIGIN_REF, value: 25 },
    ],
  };
  const solved = solveDrawingConstraints(d);
  validateSketchDrawing(solved);
  const path = solved.contours[0] as Extract<SketchDrawing["contours"][number], { type: "path" }>;
  expect(path.start[0]).toBeCloseTo(0, 6);
  expect(path.start[1]).toBeCloseTo(0, 6);
  expect(Math.hypot(...path.segments[0].end)).toBeCloseTo(25, 6);
  for (const c of solved.constraints!) expect(Math.max(...constraintResiduals(solved, c).map(Math.abs))).toBeLessThan(1e-6);
});
