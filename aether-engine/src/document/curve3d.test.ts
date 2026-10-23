import { describe, expect, it } from "vitest";
import { curve3dPolylines, moveCurve3DPoint, validateCurve3D, type Curve3DFeature } from "./curve3d";

const line: Curve3DFeature = { id: "c", type: "curve3d", name: "Path", suppressed: false, kind: "line", pointsMillimeters: [[0, 0, 0], [10, 0, 0], [10, 10, 5]] };
describe("3D sketch", () => {
  it("validates lines, splines and points", () => {
    expect(() => validateCurve3D(line)).not.toThrow();
    expect(() => validateCurve3D({ ...line, pointsMillimeters: [[0, 0, 0]] })).toThrow(/two or more/);
    expect(() => validateCurve3D({ ...line, kind: "point", pointsMillimeters: [[1, 2, 3]] })).not.toThrow();
    expect(() => validateCurve3D({ ...line, pointsMillimeters: [[0, 0, 0], [0, 0, 0]] })).toThrow(/distinct/);
    expect(() => validateCurve3D({ ...line, pointsMillimeters: [[0, 0, Number.NaN], [1, 1, 1]] })).toThrow(/finite/);
  });
  it("draws segments as given, a spline through its points, a point as a cross", () => {
    expect(curve3dPolylines(line)).toEqual([line.pointsMillimeters]);
    const spline = curve3dPolylines({ ...line, kind: "spline" })[0];
    expect(spline[0]).toEqual([0, 0, 0]); expect(spline.at(-1)).toEqual([10, 10, 5]); expect(spline.length).toBeGreaterThan(20);
    expect(curve3dPolylines({ ...line, kind: "point", pointsMillimeters: [[1, 2, 3]] })).toHaveLength(3);
  });
  it("moves one point to or by, keeping the rest", () => {
    expect(moveCurve3DPoint(line, 1, { by: [0, 5, 0] }).pointsMillimeters[1]).toEqual([10, 5, 0]);
    expect(moveCurve3DPoint(line, 2, { to: [0, 0, 9] }).pointsMillimeters).toEqual([[0, 0, 0], [10, 0, 0], [0, 0, 9]]);
    expect(() => moveCurve3DPoint(line, 7, { by: [1, 0, 0] })).toThrow(/No point 7/);
  });
});
