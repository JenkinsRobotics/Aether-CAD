import { expect, it } from "vitest";
import { angularDimension, arrowheadLines, linearDimension, radialDimension, splitAroundText, dimensionStyle } from "./dimension-geometry";
const style = dimensionStyle(1);
it("an aligned dimension passes through the label, with extensions from the geometry past the line", () => {
  const g = linearDimension([0, 0], [10, 0], [5, 4], style);
  expect(g.line).toEqual([[0, 4], [10, 4]]);
  expect(g.extensions[0][0]).toEqual([0, 1]); // one unit gap from the geometry
  expect(g.extensions[0][1]).toEqual([0, 6]); // two units past the dimension line
  expect(g.text.at).toEqual([5, 4]);
  expect(g.outside).toBe(false);
  expect(g.arrows.map((a) => a.tip)).toEqual([[0, 4], [10, 4]]);
});
it("a label past an arrow runs the line on to it and puts the text there", () => {
  const g = linearDimension([0, 0], [10, 0], [14, 4], style);
  expect(g.outside).toBe(true);
  expect(g.run).toEqual([[10, 4], [14, 4]]);
  expect(g.text.at).toEqual([14, 4]);
});
it("x and y dimensions measure the projections at the label's offset", () => {
  const x = linearDimension([2, 3], [12, 13], [7, 30], style, "x");
  expect(x.line).toEqual([[2, 30], [12, 30]]);
  const y = linearDimension([2, 3], [12, 13], [40, 8], style, "y");
  expect(y.line).toEqual([[40, 3], [40, 13]]);
});
it("the line is split around the text so it never crosses it", () => {
  expect(splitAroundText([[0, 0], [10, 0]], [5, 0], 2)).toEqual([[[0, 0], [3, 0]], [[7, 0], [10, 0]]]);
});
it("an angle is an arc through the label with tangential arrows and extensions only beyond the lines", () => {
  const g = angularDimension([0, 0], [1, 0], [0, 1], 1, [3, 3], style, [10, 2]);
  expect(g.arc.radius).toBeCloseTo(Math.hypot(3, 3));
  expect(g.text.at[0]).toBeCloseTo(3); expect(g.text.at[1]).toBeCloseTo(3);
  expect(g.extensions[0][0]).toEqual([g.arc.radius, 0]); // the first line already reaches past the arc
  expect(g.extensions[1][0]).toEqual([0, 2]); // the second stops short: extension from its end
  expect(g.arrows[0].back[1]).toBeCloseTo(1);
});
it("radius and diameter run to an outside label; arrowheads are closed triangles", () => {
  const r = radialDimension([0, 0], 5, [10, 0], "radius");
  expect(r.line).toEqual([[0, 0], [5, 0]]); expect(r.run).toEqual([[5, 0], [10, 0]]);
  const d = radialDimension([0, 0], 5, [10, 0], "diameter");
  expect(d.line).toEqual([[-5, 0], [5, 0]]);
  expect(arrowheadLines(r.arrows[0], style)).toHaveLength(3);
});
