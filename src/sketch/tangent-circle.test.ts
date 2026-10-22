/** The tangent-circle tools' core flow: a circle placed near two lines, tangent
 *  relations to both and a radius, solved into place. */
import { expect, it } from "vitest";
import { setSketchRadius, solveDrawingConstraints, type SketchDrawing } from "@aether/core/sketch";
import { constrainSketchSelection } from "./constraint-selection";

it("settles a circle of a given radius against two picked lines", () => {
  let drawing: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [40, 0] }] },
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 40] }] },
    { type: "circle", center: [7, 9], radius: 3 },
  ], constraints: [
    { id: "fa", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [0, 0] }, { id: "fb", kind: "fix", a: { contour: 0, kind: "point", index: 1 }, point: [40, 0] },
    { id: "fc", kind: "fix", a: { contour: 1, kind: "point", index: 0 }, point: [0, 0] }, { id: "fd", kind: "fix", a: { contour: 1, kind: "point", index: 1 }, point: [0, 40] },
  ] };
  const circle = { contour: 2, kind: "circle" as const };
  drawing = constrainSketchSelection(drawing, "tangent", [circle, { contour: 0, kind: "line", index: 0 }]).drawing;
  drawing = constrainSketchSelection(drawing, "tangent", [circle, { contour: 1, kind: "line", index: 0 }]).drawing;
  drawing = solveDrawingConstraints(setSketchRadius(drawing, circle, 5));
  const solved = drawing.contours[2];
  expect(solved.type).toBe("circle");
  if (solved.type === "circle") { expect(solved.radius).toBeCloseTo(5, 6); expect(solved.center[0]).toBeCloseTo(5, 5); expect(solved.center[1]).toBeCloseTo(5, 5); }
});
