import { expect, it } from "vitest";
import { solveDrawingConstraints } from "./solve";
import type { SketchDrawing } from "../drawing";

it("collinear brings a second line onto the first line's extension", () => {
  const drawing: SketchDrawing = {
    type: "drawing",
    contours: [
      { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }] },
      { type: "path", start: [20, 3], segments: [{ type: "line", end: [30, 5] }] },
    ],
    constraints: [
      { id: "fix-a", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [0, 0] },
      { id: "fix-b", kind: "fix", a: { contour: 0, kind: "point", index: 1 }, point: [10, 0] },
      { id: "col", kind: "collinear", a: { contour: 0, kind: "line", index: 0 }, b: { contour: 1, kind: "line", index: 0 } },
    ],
  };
  const solved = solveDrawingConstraints(drawing);
  const second = solved.contours[1];
  if (second.type !== "path") throw new Error("path expected");
  expect(Math.abs(second.start[1])).toBeLessThan(1e-6);
  expect(Math.abs(second.segments[0].end[1])).toBeLessThan(1e-6);
});
