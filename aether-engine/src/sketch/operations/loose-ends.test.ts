import { expect, it } from "vitest";
import { looseEnds } from "./loose-ends";
import type { SketchDrawing } from "../drawing";

it("finds open path ends that nothing else touches or ties", () => {
  const drawing: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }] },
    { type: "path", start: [10, 0], segments: [{ type: "line", end: [10, 8] }] },
    { type: "path", start: [30, 0], segments: [{ type: "line", end: [40, 0] }, { type: "line", end: [40, 5] }, { type: "line", end: [30, 0] }] },
  ] };
  const ends = looseEnds(drawing);
  expect(ends.map((e) => `${e.ref.contour}:${e.ref.index}`).sort()).toEqual(["0:0", "1:1"]);
  const tied: SketchDrawing = { ...drawing, constraints: [{ id: "c", kind: "coincident", a: { contour: 0, kind: "point", index: 0 }, b: { contour: 1, kind: "point", index: 1 } }] };
  expect(looseEnds(tied)).toEqual([]);
});
