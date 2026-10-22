import { expect, it } from "vitest";
import { constrainRegularPolygon } from "./regular-polygon";
import { solveDrawingConstraints } from "../drawing-constraints";
import type { SketchDrawing } from "../drawing";

it("turns a closed chain of lines into a regular polygon: equal sides on one circle", () => {
  // A lopsided quadrilateral.
  const d: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 1] }, { type: "line", end: [9, 11] }, { type: "line", end: [-1, 9] }, { type: "line", end: [0, 0] }] },
  ] };
  const { drawing, sides } = constrainRegularPolygon(d, [{ contour: 0, kind: "line", index: 0 }, { contour: 0, kind: "line", index: 2 }]);
  expect(sides).toBe(4);
  expect(drawing.contours[1]).toMatchObject({ type: "circle", construction: true });
  expect(drawing.constraints?.filter((c) => c.kind === "coincident")).toHaveLength(4);
  expect(drawing.constraints?.filter((c) => c.kind === "equal")).toHaveLength(3);
  const solved = solveDrawingConstraints(drawing);
  const p = solved.contours[0];
  if (p.type !== "path") throw new Error();
  const corners = [p.start, ...p.segments.slice(0, -1).map((s) => s.end)];
  const lengths = corners.map((c, i) => { const n = corners[(i + 1) % 4]; return Math.hypot(n[0] - c[0], n[1] - c[1]); });
  for (const l of lengths) expect(l).toBeCloseTo(lengths[0], 4);
  const circle = solved.contours[1];
  if (circle.type !== "circle") throw new Error();
  for (const c of corners) expect(Math.hypot(c[0] - circle.center[0], c[1] - circle.center[1])).toBeCloseTo(circle.radius, 4);
  expect(() => constrainRegularPolygon(d, [{ contour: 0, kind: "line", index: 0 }, { contour: 1, kind: "line", index: 0 }])).toThrow(/one closed chain/);
});
