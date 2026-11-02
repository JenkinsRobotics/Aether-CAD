import type { SketchDrawing, SketchPoint } from "../drawing";
import type { DrawingConstraint } from "./types";
import { resolve } from "./entities";

/** Positive is right of the directed line. Reversing a line reverses the sign. */
export function signedLineDistance(point: SketchPoint, line: [SketchPoint, SketchPoint]): number {
  const dx = line[1][0] - line[0][0];
  const dy = line[1][1] - line[0][1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-10) throw Error("Select a nonzero-length line for distance.");
  return ((point[0] - line[0][0]) * dy - (point[1] - line[0][1]) * dx) / length;
}

function spacing(drawing: SketchDrawing, constraint: DrawingConstraint): number | undefined {
  if (constraint.kind !== "distance" || constraint.reference || !constraint.b) return;
  const a = resolve(drawing, constraint.a);
  const b = resolve(drawing, constraint.b);
  if (a.line && b.line) {
    const midpoint: SketchPoint = [(a.line[0][0] + a.line[1][0]) / 2, (a.line[0][1] + a.line[1][1]) / 2];
    return signedLineDistance(midpoint, b.line);
  }
  if (a.point && b.line) return signedLineDistance(a.point, b.line);
  if (a.line && b.point) return signedLineDistance(b.point, a.line);
}

/** Validate the saved contract even when external geometry is unavailable. */
export function validateDistanceSideMetadata(constraint: DrawingConstraint): void {
  if (constraint.distanceSide === undefined) return;
  const kinds = [constraint.a?.kind, constraint.b?.kind];
  if ((constraint.distanceSide !== 1 && constraint.distanceSide !== -1) ||
      constraint.kind !== "distance" || constraint.reference ||
      !kinds.includes("line") || !kinds.every(kind => ["point", "line", "curve"].includes(kind ?? "")))
    throw Error("Distance side requires a driving point/line or parallel-line distance and a sign of +1 or -1.");
}

export function validateDistanceSide(drawing: SketchDrawing, constraint: DrawingConstraint): void {
  validateDistanceSideMetadata(constraint);
  if (constraint.distanceSide !== undefined && spacing(drawing, constraint) === undefined)
    throw Error("Distance side requires a driving point/line or parallel-line distance and a sign of +1 or -1.");
}

/** Capture once before solving, never from an intermediate solver iterate or a
 * newly moved projection. Zero-spacing legacy geometry uses the positive side. */
export function captureDistanceSides(drawing: SketchDrawing): void {
  for (const constraint of drawing.constraints ?? []) {
    validateDistanceSide(drawing, constraint);
    if (constraint.distanceSide !== undefined) continue;
    const value = spacing(drawing, constraint);
    if (value !== undefined) constraint.distanceSide = value < 0 ? -1 : 1;
  }
}

/** The side a driving line distance currently measures on (+1 right of the directed line,
 * -1 left), or undefined when the dimension involves no line. A typed negative value flips it. */
export function distanceSideOf(drawing: SketchDrawing, constraint: DrawingConstraint): 1 | -1 | undefined {
  const value = spacing(drawing, constraint);
  if (value === undefined) return undefined;
  return constraint.distanceSide ?? (value < 0 ? -1 : 1);
}

