import { validateSketchDrawing, type SketchDrawing } from "../drawing";
import type { SketchEntityRef } from "../solver/types";
import { pointAtArcLengthFraction } from "../solver/point-along";
import { referencedContour } from "../solver/projected-context";

/** Divide a curve (line, arc, circle, bezier, ellipse, conic) into `segments` equal-arc-length
 *  spans by placing parametric point contours held by `point-along` constraints (`sketch.point.divide`). */
export function divideSketchCurve(
  source: SketchDrawing,
  curveRef: SketchEntityRef,
  segments: number,
): { drawing: SketchDrawing; pointContourIndices: number[] } {
  if (!Number.isInteger(segments) || segments < 2 || segments > 200)
    throw new Error("Divide curve requires an integer segment count from 2 to 200.");
  const next = structuredClone(source);
  const contour = referencedContour(next, curveRef);
  if (!contour) throw new Error("Select an existing curve to divide.");
  const isClosedCircle = contour.type === "circle" && curveRef.kind === "circle";
  const count = isClosedCircle ? segments : segments - 1;
  const usedIds = new Set(next.constraints?.map((c) => c.id));
  const nextId = () => {
    let i = 1;
    while (usedIds.has(`divide-${i}`)) i++;
    const id = `divide-${i}`;
    usedIds.add(id);
    return id;
  };
  const pointContourIndices: number[] = [];
  next.constraints ??= [];
  for (let k = 1; k <= count; k++) {
    const frac = isClosedCircle ? (k - 1) / segments : k / segments;
    const pt = pointAtArcLengthFraction(next, curveRef, frac);
    const pointContourIndex = next.contours.length;
    next.contours.push({ type: "path", start: pt, segments: [], construction: true });
    pointContourIndices.push(pointContourIndex);
    next.constraints.push({
      id: nextId(),
      kind: "point-along",
      a: { contour: pointContourIndex, kind: "point", index: 0 },
      b: structuredClone(curveRef),
      value: frac,
    });
  }
  validateSketchDrawing(next);
  return { drawing: next, pointContourIndices };
}
