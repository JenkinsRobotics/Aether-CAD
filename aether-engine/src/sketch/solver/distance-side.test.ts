import { expect, it } from "vitest";
import type { SketchDrawing } from "../drawing";
import { solveDrawingConstraints } from "./solve";
import { constraintResiduals } from "./residuals";
import { copySketchContours } from "../operations/transform";
import { setDimensionReference } from "../operations/dimension-reference";

function drawing(): SketchDrawing {
  return {
    type: "drawing",
    contours: [
      { type: "path", start: [0, 50], segments: [{ type: "line", end: [100, 50] }] },
      { type: "path", start: [50, 45], segments: [] },
    ],
    constraints: [{
      id: "gap", kind: "distance", value: 5,
      a: { kind: "point", contour: 1, index: 0 },
      b: { kind: "line", contour: 0, index: 0 },
    }],
  };
}

it("captures once and drives the same side for either selection order", () => {
  for (const reverse of [false, true]) {
    const input = drawing();
    const c = input.constraints![0];
    if (reverse) [c.a, c.b] = [c.b!, c.a];
    const saved = solveDrawingConstraints(input);
    expect(saved.constraints![0].distanceSide).toBe(1);
    const moved = saved.contours[0];
    if (moved.type !== "path") throw Error();
    moved.start[1] = moved.segments[0].end[1] = 20;
    const solved = solveDrawingConstraints(saved, { fixedContours: new Set([0]) });
    expect(solved.contours[1]).toMatchObject({ start: [expect.closeTo(50), expect.closeTo(15)] });
    expect(c.distanceSide).toBeUndefined();
  }
});

it("keeps parallel-line spacing on the authored side across a source crossing", () => {
  const input = drawing();
  input.contours[1] = { type: "path", start: [10, 45], segments: [{ type: "line", end: [90, 45] }] };
  input.constraints![0].a = { kind: "line", contour: 1, index: 0 };
  const saved = solveDrawingConstraints(input);
  const rail = saved.contours[0];
  if (rail.type !== "path") throw Error();
  rail.start[1] = rail.segments[0].end[1] = 20;
  const solved = solveDrawingConstraints(saved, { fixedContours: new Set([0]) });
  expect(solved.contours[1]).toMatchObject({ start: [expect.closeTo(10), expect.closeTo(15)], segments: [{ end: [expect.closeTo(90), expect.closeTo(15)] }] });
});

it("reverses side under reflection and measures reference dimensions without a driving side", () => {
  const source = solveDrawingConstraints(drawing());
  const copied = copySketchContours(source, [0, 1], [{ a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 }]);
  expect(copied.constraints!.at(-1)!.distanceSide).toBe(-1);
  for (const c of copied.constraints!) expect(constraintResiduals(copied, c).every(r => Math.abs(r) < 1e-8)).toBe(true);
  const reference = setDimensionReference(source, "gap", true);
  expect(reference.constraints![0].distanceSide).toBeUndefined();
  expect(setDimensionReference(reference, "gap", false).constraints![0].distanceSide).toBe(1);
});

it("rejects invalid or misplaced side metadata without mutating geometry", () => {
  for (const side of [0, 2, null, true, "1"]) {
    const input = drawing();
    Object.assign(input.constraints![0], { distanceSide: side });
    expect(() => solveDrawingConstraints(input)).toThrow(/Distance side/);
  }
  for (const patch of [{ reference: true }, { kind: "horizontal" }, { b: { kind: "point", contour: 0, index: 0 } }]) {
    const input = drawing();
    Object.assign(input.constraints![0], { distanceSide: 1, ...patch });
    expect(() => solveDrawingConstraints(input)).toThrow(/Distance side/);
  }
});
