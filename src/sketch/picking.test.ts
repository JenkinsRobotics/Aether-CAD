import { describe, expect, it } from "vitest";
import { pickSketchEntity, pickSketchRegion } from "./picking";
import type { SketchDrawing } from "@aether/core/sketch";

it("prioritizes a coincident construction point over an earlier curve", () => {
  const d: SketchDrawing = {
    type: "drawing",
    contours: [
      { type: "circle", center: [0, 0], radius: 5 },
      { type: "path", construction: true, start: [0, 5], segments: [] },
    ],
  };
  expect(pickSketchEntity(d, [0, 5])?.ref).toMatchObject({
    contour: 1,
    kind: "point",
  });
  expect(pickSketchEntity(d, [5, 0])?.ref).toMatchObject({
    contour: 0,
    kind: "circle",
  });
});

describe("picking a closed region by clicking inside it", () => {
  const square = (x: number, size: number) => ({
    type: "path" as const,
    start: [x, 0] as [number, number],
    segments: [
      { type: "line" as const, end: [x + size, 0] as [number, number] },
      { type: "line" as const, end: [x + size, size] as [number, number] },
      { type: "line" as const, end: [x, size] as [number, number] },
      { type: "line" as const, end: [x, 0] as [number, number] },
    ],
  });

  it("picks the region the point is inside, and nothing outside them", () => {
    const drawing = { type: "drawing" as const, contours: [square(0, 10), square(20, 10)] };
    expect(pickSketchRegion(drawing, [5, 5])).toBe(0);
    expect(pickSketchRegion(drawing, [25, 5])).toBe(1);
    expect(pickSketchRegion(drawing, [15, 5])).toBeNull();
    expect(pickSketchRegion(drawing, [5, 50])).toBeNull();
  });

  it("picks a circle's interior, which has no straight edges at all", () => {
    const drawing = {
      type: "drawing" as const,
      contours: [{ type: "circle" as const, center: [0, 0] as [number, number], radius: 5 }],
    };
    expect(pickSketchRegion(drawing, [0, 0])).toBe(0);
    expect(pickSketchRegion(drawing, [4.9, 0])).toBe(0);
    // Just outside the rim: the sampler approximates the circle, so allow the
    // chord error rather than asserting on a point that sits within it.
    expect(pickSketchRegion(drawing, [5.6, 0])).toBeNull();
  });

  it("prefers the smallest region containing the point, so nesting works", () => {
    const drawing = { type: "drawing" as const, contours: [square(0, 40), square(10, 10)] };
    // Inside both; the inner one is what the user is pointing at.
    expect(pickSketchRegion(drawing, [15, 5])).toBe(1);
    expect(pickSketchRegion(drawing, [35, 35])).toBe(0);
  });

  it("ignores construction and open contours, which bound nothing", () => {
    const open = {
      type: "path" as const,
      start: [0, 0] as [number, number],
      segments: [
        { type: "line" as const, end: [10, 0] as [number, number] },
        { type: "line" as const, end: [10, 10] as [number, number] },
      ],
    };
    expect(pickSketchRegion({ type: "drawing", contours: [open] } as never, [5, 2])).toBeNull();
    expect(
      pickSketchRegion(
        { type: "drawing", contours: [{ ...square(0, 10), construction: true }] } as never,
        [5, 5],
      ),
    ).toBeNull();
  });
});
