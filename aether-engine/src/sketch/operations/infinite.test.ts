import { expect, it } from "vitest";
import { setSketchInfinite } from "./infinite";
import { validateSketchDrawing, type SketchDrawing } from "../drawing";

it("makes single lines infinite construction lines and back, and skips the rest", () => {
  const d: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }] },
    { type: "circle", center: [0, 0], radius: 5 },
  ] };
  const on = setSketchInfinite(d, [{ contour: 0, kind: "contour" }, { contour: 1, kind: "contour" }]);
  expect(on.changed).toBe(1); expect(on.skipped).toBe(1);
  expect(on.drawing.contours[0]).toMatchObject({ infinite: true, construction: true });
  const off = setSketchInfinite(on.drawing, [{ contour: 0, kind: "contour" }]);
  expect(off.drawing.contours[0]).not.toHaveProperty("infinite");
  expect(off.drawing.contours[0]).toMatchObject({ construction: true });
  // The flag is only valid on a single construction line.
  expect(() => validateSketchDrawing({ type: "drawing", contours: [{ type: "path", start: [0, 0], segments: [{ type: "line", end: [1, 0] }], infinite: true }] })).toThrow(/single construction line/);
  expect(() => setSketchInfinite(d, [{ contour: 1, kind: "contour" }])).toThrow(/single lines/);
});
