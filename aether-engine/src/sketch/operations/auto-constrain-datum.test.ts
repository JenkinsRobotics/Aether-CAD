import { describe, expect, it } from "vitest";
import { autoConstrainFromDatum } from "./auto-constrain";
import type { SketchDrawing } from "../drawing";

const rectangle: SketchDrawing = { type: "drawing", contours: [{ type: "path", start: [10, 5], segments: [{ type: "line", end: [40, 5] }, { type: "line", end: [40, 25] }, { type: "line", end: [10, 25] }, { type: "line", end: [10, 5] }] }] };
describe("AutoConstrain from datum", () => {
  it("dimensions a rectangle from a fixed origin point once per tied coordinate", () => {
    const { drawing, added } = autoConstrainFromDatum(rectangle);
    const dims = drawing.constraints!.filter((c) => c.kind.endsWith("-distance"));
    // Four horizontal/vertical relations, the origin's fix, and two x and two y positions.
    expect(drawing.constraints!.filter((c) => c.kind === "horizontal" || c.kind === "vertical")).toHaveLength(4);
    expect(dims.map((c) => [c.kind, c.value])).toEqual([["horizontal-distance", 10], ["vertical-distance", 5], ["horizontal-distance", 40], ["vertical-distance", 25]]);
    expect(added).toBe(4 + 1 + 4);
    expect(drawing.contours.at(-1)).toMatchObject({ type: "path", start: [0, 0], construction: true });
  });
  it("measures from a chosen vertex, adding no point of its own", () => {
    const two: SketchDrawing = { type: "drawing", contours: [rectangle.contours[0], { type: "path", start: [40, 25], segments: [{ type: "line", end: [70, 60] }] }] };
    const { drawing } = autoConstrainFromDatum(two, { datum: { contour: 0, kind: "point", index: 0 } });
    expect(drawing.contours).toHaveLength(2);
    const dims = drawing.constraints!.filter((c) => c.kind.endsWith("-distance")).map((c) => [c.kind, c.b?.contour, c.b?.index, c.value]);
    // The rectangle needs its far x and far y; the separate line needs both ends.
    expect(dims).toEqual([["horizontal-distance", 0, 1, 30], ["vertical-distance", 0, 2, 20], ["horizontal-distance", 1, 0, 30], ["vertical-distance", 1, 0, 20], ["horizontal-distance", 1, 1, 60], ["vertical-distance", 1, 1, 55]]);
  });
});
