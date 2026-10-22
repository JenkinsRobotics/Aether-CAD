import { expect, it } from "vitest";
import { autoConstrainDrawing } from "./auto-constrain";
import type { SketchDrawing } from "../drawing";

it("adds horizontal, vertical and coincident relations within tolerance, once", () => {
  const drawing: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0.1] }, { type: "line", end: [10.2, 8] }] },
    { type: "path", start: [10.21, 8.01], segments: [{ type: "line", end: [3, 12] }] },
  ] };
  const first = autoConstrainDrawing(drawing);
  expect(first.added).toBe(3);
  expect(first.drawing.constraints!.map((c) => c.kind).sort()).toEqual(["coincident", "horizontal", "vertical"]);
  expect(autoConstrainDrawing(first.drawing).added).toBe(0);
});
