import { appendOffsetRelations } from "./offset-relations";
import { validateSketchDrawing, type SketchDrawing } from "../drawing";
import { offsetSketchContour } from "../curves/offset";
export { offsetSketchContour } from "../curves/offset";

export interface OffsetSketchOptions {
  distance: number;
  /** Offset equally on both +distance and -distance sides. */
  symmetric?: boolean;
  /** Optional independent opposite-side offset distance. */
  distance2?: number;
  /** Number of concentric copies (1..100). */
  instances?: number;
}

export function offsetSketch(
  source: SketchDrawing,
  indices: number[],
  distance: number,
): SketchDrawing {
  if (!indices.length) throw Error("Select contours to offset.");
  const unique = [...new Set(indices)];
  if (unique.some((i) => !Number.isInteger(i) || !source.contours[i]))
    throw Error("Invalid offset contour.");
  const next = structuredClone(source);
  next.contours.push(
    ...unique.map((i) => offsetSketchContour(source.contours[i], distance)),
  );
  appendOffsetRelations(source, next, unique, distance);
  validateSketchDrawing(next);
  return next;
}

/** Multi-instance, symmetric, and two-sided associative sketch offset (`sketch.offset`). */
export function offsetSketchAdvanced(
  source: SketchDrawing,
  indices: number[],
  options: OffsetSketchOptions,
): SketchDrawing {
  const { distance, symmetric = false, distance2, instances = 1 } = options;
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-8)
    throw new Error("Offset distance must be finite and nonzero.");
  if (!Number.isInteger(instances) || instances < 1 || instances > 100)
    throw new Error("Offset instances must be an integer between 1 and 100.");
  let current = structuredClone(source);
  for (let step = 1; step <= instances; step++) {
    current = offsetSketch(current, indices, distance * step);
    if (symmetric) {
      current = offsetSketch(current, indices, -distance * step);
    }
  }
  if (distance2 !== undefined && !symmetric) {
    if (!Number.isFinite(distance2) || Math.abs(distance2) < 1e-8)
      throw new Error("Second offset distance must be finite and nonzero.");
    for (let step = 1; step <= instances; step++) {
      current = offsetSketch(current, indices, -Math.abs(distance2) * Math.sign(distance) * step);
    }
  }
  return current;
}

/** Break offset association (`sketch.offset.break`): retains offset geometry as free editable
 *  contours by removing `offset` relations targeting the chosen (or all) contours. */
export function breakOffsetAssociation(
  source: SketchDrawing,
  contourIndices?: number[],
): { drawing: SketchDrawing; brokenCount: number } {
  const next = structuredClone(source);
  if (!next.constraints?.length) return { drawing: next, brokenCount: 0 };
  const filterSet = contourIndices?.length ? new Set(contourIndices) : undefined;
  let brokenCount = 0;
  next.constraints = next.constraints.filter((c) => {
    if (c.kind !== "offset") return true;
    const matches = !filterSet || filterSet.has(c.a.contour) || (c.b !== undefined && filterSet.has(c.b.contour));
    if (matches) {
      brokenCount++;
      return false;
    }
    return true;
  });
  validateSketchDrawing(next);
  return { drawing: next, brokenCount };
}
