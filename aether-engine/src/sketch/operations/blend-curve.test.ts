import { describe, expect, it } from "vitest";
import { blendCurve } from "./blend-curve";
import { constraintResiduals } from "../solver/residuals";
import type { SketchDrawing } from "../drawing";

// A horizontal line ending at (10, 0) and an arc starting at (30, 10), curving away.
const drawing: SketchDrawing = { type: "drawing", contours: [
  { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }] },
  { type: "path", start: [30, 10], segments: [{ type: "arc", middle: [37.071, 12.929], end: [40, 20] }] },
] };
const settled = (d: SketchDrawing) => (d.constraints ?? []).every((c) => constraintResiduals(d, c).every((r) => Math.abs(r) < 1e-6));

describe("blend curve", () => {
  it("joins two free ends with a tangent cubic", () => {
    const next = blendCurve(drawing, { contour: 0, kind: "point", index: 1 }, { contour: 1, kind: "point", index: 0 });
    const blend = next.contours[2];
    expect(blend).toMatchObject({ type: "path", start: [10, 0], segments: [{ type: "bezier", end: [30, 10] }] });
    // Leaves the line along +x.
    const control = (blend as { segments: { controls: number[][] }[] }).segments[0].controls[0];
    expect(control[1]).toBeCloseTo(0, 9); expect(control[0]).toBeGreaterThan(10);
    expect(next.constraints!.map((c) => c.kind)).toEqual(["coincident", "coincident", "tangent", "tangent"]);
    expect(settled(next)).toBe(true);
  });
  it("matches curvature for G2 without moving the source curves", () => {
    // Built backwards from a known G2 cubic (0,0) (10,0) (20,0) (30,10): a line into its start, and
    // an arc leaving its end with the same tangent and curvature (radius 30√2, centre (0, 40)).
    const r = 30 * Math.SQRT2, at = (deg: number): [number, number] => [r * Math.cos(deg * Math.PI / 180), 40 + r * Math.sin(deg * Math.PI / 180)];
    const lines: SketchDrawing = { type: "drawing", contours: [
      { type: "path", start: [-10, 0], segments: [{ type: "line", end: [0, 0] }] },
      { type: "path", start: [30, 10], segments: [{ type: "arc", middle: at(-30), end: at(-15) }] },
    ] };
    const next = blendCurve(lines, { contour: 0, kind: "point", index: 1 }, { contour: 1, kind: "point", index: 0 }, "g2");
    expect(next.constraints!.filter((c) => c.kind === "curvature")).toHaveLength(2);
    expect(next.contours[0]).toEqual(lines.contours[0]);
    expect(next.contours[1]).toEqual(lines.contours[1]);
    expect(settled(next)).toBe(true);
  });
  it("says so when no G2 blend fits", () => {
    expect(() => blendCurve(drawing, { contour: 0, kind: "point", index: 1 }, { contour: 1, kind: "point", index: 0 }, "g2")).toThrow(/No curvature-matched blend/);
  });
  it("refuses an interior point or the same end twice", () => {
    const longer: SketchDrawing = { type: "drawing", contours: [{ type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }, { type: "line", end: [20, 0] }] }, drawing.contours[1]] };
    expect(() => blendCurve(longer, { contour: 0, kind: "point", index: 1 }, { contour: 1, kind: "point", index: 0 })).toThrow(/free end/);
    expect(() => blendCurve(drawing, { contour: 0, kind: "point", index: 1 }, { contour: 0, kind: "point", index: 1 })).toThrow(/two different/);
  });
});
