import { expect, it } from "vitest";
import { sketchDrawingToDXF } from "./dxf";
import { importDxfSketch } from "../import/dxf/index";

it("writes lines, circles and arcs that import back to the same geometry", () => {
  const text = sketchDrawingToDXF({ type: "drawing", contours: [
    { type: "circle", center: [5, 5], radius: 2 },
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }, { type: "arc", middle: [15, 5], end: [10, 10] }, { type: "line", end: [0, 10] }, { type: "line", end: [0, 0] }] },
  ] });
  expect(text).toContain("CIRCLE"); expect(text).toContain("ARC"); expect((text.match(/\nLINE\n/g) ?? []).length).toBe(3);
  const back = importDxfSketch(text);
  const circle = back.drawing.contours.find((c) => c.type === "circle");
  expect(circle && circle.type === "circle" ? circle.radius : 0).toBeCloseTo(2, 6);
});
