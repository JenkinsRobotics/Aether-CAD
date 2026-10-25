import { expect, it } from "vitest";
import type { SketchContour } from "../../sketch/drawing";
import { deduplicateProjection } from "./deduplicate";

it("merges reversed coincident edges without rounding geometry or removing distinct arcs", () => {
  const a: SketchContour = { type: "path", start: [0, 0], segments: [{ type: "arc", middle: [1, 1], end: [2, 0] }] };
  const b: SketchContour = { type: "path", start: [2, 0], segments: [{ type: "arc", middle: [1, 1], end: [0, 0] }] };
  const other: SketchContour = { type: "path", start: [2, 0], segments: [{ type: "arc", middle: [1, -1], end: [0, 0] }] };
  expect(deduplicateProjection([a, b, other])).toEqual([a, other]);
  const exact: SketchContour = { type: "circle", center: [0.123456789, 0], radius: 2.123456789 };
  expect(deduplicateProjection([exact, structuredClone(exact)])[0]).toBe(exact);
});
