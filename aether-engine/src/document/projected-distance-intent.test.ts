import { expect, it } from "vitest";
import type { SketchDrawing } from "../sketch/drawing";
import { solveProjectedConstraints } from "./projected-constraints";

function rail(height: number): SketchDrawing {
  return {
    type: "drawing",
    contours: [{
      id: "rail", type: "path", start: [0, height],
      segments: [{ type: "line", end: [100, height] }],
    }],
  };
}

it.each([-1, 1])("retains the point's authored side %s when a projected rail crosses it", side => {
  const authored: SketchDrawing = {
    type: "drawing",
    contours: [{ type: "path", start: [50, 50 + side * 5], segments: [] }],
    constraints: [{
      id: "gap", kind: "distance", value: 5,
      a: { kind: "point", contour: 0, index: 0 },
      b: { kind: "line", contour: -1, projectedContourId: "rail", index: 0 },
    }],
  };
  const saved = JSON.parse(JSON.stringify(solveProjectedConstraints(authored, rail(50))));
  for (const height of [20, 80, 6, 400, 50]) {
    const solved = solveProjectedConstraints(saved, rail(height));
    expect(solved.contours[0]).toMatchObject({ start: [expect.closeTo(50, 6), expect.closeTo(height + side * 5, 6)] });
  }
});
