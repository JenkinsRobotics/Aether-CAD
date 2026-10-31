import { expect, it } from "vitest";
import { insertSketchSplinePoint } from "./insert-spline-point";
import { removeSketchSplinePoint } from "./remove-spline-point";
import { segmentPoint } from "../curves/parameterization";
import { fitSketchSpline } from "../curves/fit-spline";
import type { SketchDrawing } from "../drawing";

const cubic = (): SketchDrawing => ({ type: "drawing", contours: [{ type: "path", start: [0, 0], segments: [{ type: "bezier", controls: [[3, 6], [7, 6]], end: [10, 0] }] }] });

it("removing an inserted point restores the original cubic and drops the join relation", () => {
  const inserted = insertSketchSplinePoint(cubic(), [5, 4.5], 0.1);
  expect(inserted.constraints?.length).toBe(1);
  const back = removeSketchSplinePoint(inserted, [5, 4.5], 0.5);
  const c = back.contours[0];
  if (c.type !== "path") throw Error("path");
  expect(c.segments).toHaveLength(1);
  if (c.segments[0].type !== "bezier") throw Error("bezier");
  expect(c.segments[0].controls[0][0]).toBeCloseTo(3, 6); expect(c.segments[0].controls[0][1]).toBeCloseTo(6, 6);
  expect(c.segments[0].controls[1][0]).toBeCloseTo(7, 6); expect(c.segments[0].controls[1][1]).toBeCloseTo(6, 6);
  expect(back.constraints).toBeUndefined();
});

it("merges two fitted spans by least squares, keeping the outer tangents and the ends, and refuses a dimensioned point", () => {
  const spline = fitSketchSpline([[0, 0], [10, 4], [20, 6], [30, 8]]);
  const drawing: SketchDrawing = { type: "drawing", contours: [spline] };
  const merged = removeSketchSplinePoint(drawing, [10, 4], 0.5);
  const before = drawing.contours[0], after = merged.contours[0];
  if (before.type !== "path" || after.type !== "path") throw Error("path");
  expect(after.segments).toHaveLength(2);
  expect(after.segments[0].end).toEqual([20, 6]);
  // The merged span stays within half a millimetre of the old two over 20 mm of curve.
  let worst = 0;
  for (let k = 0; k <= 20; k++) {
    const p = segmentPoint(after.start, after.segments[0], k / 20);
    const d = Math.min(...[0, 1].flatMap((i) => Array.from({ length: 21 }, (_, j) => { const q = segmentPoint(i === 0 ? before.start : before.segments[0].end, before.segments[i], j / 20); return Math.hypot(q[0] - p[0], q[1] - p[1]); })));
    worst = Math.max(worst, d);
  }
  expect(worst).toBeLessThan(0.5);
  const pinned: SketchDrawing = { ...drawing, constraints: [{ id: "fix", kind: "fix", a: { contour: 0, kind: "point", index: 1 }, point: [10, 4] } as never] };
  expect(() => removeSketchSplinePoint(pinned, [10, 4], 0.5)).toThrow(/Remove dimensions and relations/);
});
