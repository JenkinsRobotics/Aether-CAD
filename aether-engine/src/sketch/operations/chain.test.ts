import { expect, it } from "vitest";
import { chainSketchSelection } from "./chain";
import type { SketchDrawing } from "../drawing";

it("chains edges joined end to end, across paths, and stops at a gap", () => {
  const d: SketchDrawing = { type: "drawing", contours: [
    { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }, { type: "arc", middle: [15, 5], end: [20, 0] }] },
    { type: "path", start: [20, 0], segments: [{ type: "line", end: [30, 0] }] },
    { type: "path", start: [40, 0], segments: [{ type: "line", end: [50, 0] }] },
  ] };
  const chain = chainSketchSelection(d, [{ contour: 0, kind: "line", index: 0 }]);
  expect(chain).toEqual([{ contour: 0, kind: "line", index: 0 }, { contour: 0, kind: "arc", index: 1 }, { contour: 1, kind: "line", index: 0 }]);
  expect(chainSketchSelection(d, [{ contour: 2, kind: "line", index: 0 }])).toEqual([{ contour: 2, kind: "line", index: 0 }]);
  expect(() => chainSketchSelection(d, [])).toThrow(/Select an edge/);
});
