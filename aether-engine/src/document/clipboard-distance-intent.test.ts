import { expect, it } from "vitest";
import type { SketchDrawing } from "../sketch/drawing";
import { solveDrawingConstraints } from "../sketch/solver/solve";
import {
  createSketchClipboard,
  parseSketchClipboard,
  pasteSketchClipboard,
  serializeSketchClipboard,
} from "./sketch-clipboard";

it("versions side intent and preserves it when pasting a reflected legacy fragment", () => {
  const drawing: SketchDrawing = {
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
  const clipboard = createSketchClipboard(drawing, [0, 1]);
  expect(clipboard.version).toBe(2);
  expect(clipboard.drawing.constraints![0].distanceSide).toBe(1);
  // Even a caller that retained a legacy header must write a guarded payload.
  const text = serializeSketchClipboard({ ...clipboard, version: 1 });
  expect(parseSketchClipboard(text).version).toBe(2);
  const pasted = pasteSketchClipboard({ type: "drawing", contours: [] }, [], text,
    { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 }).drawing;
  expect(pasted.constraints![0].distanceSide).toBe(-1);
  const rail = pasted.contours[0];
  if (rail.type !== "path") throw Error("Expected a rail");
  rail.start[1] = rail.segments[0].end[1] = -80;
  const solved = solveDrawingConstraints(pasted, { fixedContours: new Set([0]) });
  expect(solved.contours[1]).toMatchObject({ start: [expect.closeTo(50), expect.closeTo(-75)] });
  expect(drawing.constraints![0].distanceSide).toBeUndefined();
});

it("retains the legacy clipboard format for geometry without new intent", () => {
  const clipboard = createSketchClipboard({ type: "drawing", contours: [
    { type: "circle", center: [0, 0], radius: 2 },
  ] }, [0]);
  expect(clipboard.version).toBe(1);
  expect(parseSketchClipboard(serializeSketchClipboard(clipboard))).toEqual(clipboard);
  expect(() => parseSketchClipboard(JSON.stringify({ ...clipboard, version: 3 }))).toThrow(/supported/);
});
