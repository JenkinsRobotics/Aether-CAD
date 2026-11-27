/** Constraint-adapting sketch Rotate and Scale (`sketch.rotate`, `sketch.scale`):
 *  transforms selected contours while adapting axis-locked (`horizontal`/`vertical`) and
 *  dimensional constraints cleanly instead of failing on valid rigid/similarity transforms. */
import { validateSketchDrawing, type SketchDrawing, type SketchPoint } from "../drawing";
import { similarityTransform, transformContour, transformPoint } from "../curves/similarity";
import { constraintResiduals } from "../drawing-constraints";
import type { DrawingConstraint } from "../solver/types";
import { selectedContours } from "./transform";

const SCALED_DIMENSION_KINDS = new Set([
  "distance",
  "horizontal-distance",
  "vertical-distance",
  "length",
  "radius",
  "diameter",
  "arc-length",
  "linear-diameter",
  "point-circle-distance",
  "line-circle-distance",
  "circle-circle-distance",
  "slot-overall-length",
  "offset",
]);

function constraintContours(c: DrawingConstraint): number[] {
  const out = [c.a.contour];
  if (c.b) out.push(c.b.contour);
  if (c.axis) out.push(c.axis.contour);
  return out;
}

/** Rotate selected sketch contours around `center` by `angleDegrees`, adapting `horizontal`/`vertical`
 *  constraints on 90°/180° multiples and dropping oblique axis locks or conflicting external constraints. */
export function rotateSketchContours(
  drawing: SketchDrawing,
  selection: readonly number[],
  center: SketchPoint,
  angleDegrees: number,
  options?: { adaptFixed?: boolean },
): { drawing: SketchDrawing; adaptedConstraints: number; droppedConstraints: number } {
  validateSketchDrawing(drawing);
  if (!Number.isFinite(angleDegrees)) throw new Error("Rotation angle must be finite.");
  const indices = selectedContours(drawing, selection);
  const selSet = new Set(indices);
  const rad = (angleDegrees * Math.PI) / 180;
  const xform = similarityTransform(center, center, rad, 1);

  const next = structuredClone(drawing);
  for (const i of indices) next.contours[i] = transformContour(drawing.contours[i], xform);

  const mod180 = ((angleDegrees % 180) + 180) % 180;
  const isParallelTurn = Math.abs(mod180) < 1e-4 || Math.abs(mod180 - 180) < 1e-4;
  const isQuarterTurn = Math.abs(mod180 - 90) < 1e-4;

  let adaptedConstraints = 0;
  let droppedConstraints = 0;
  if (next.constraints?.length) {
    const kept: DrawingConstraint[] = [];
    for (const c of next.constraints) {
      const refs = constraintContours(c);
      const touchesSel = refs.some((idx) => selSet.has(idx));
      if (!touchesSel) {
        kept.push(c);
        continue;
      }
      const allSel = refs.every((idx) => selSet.has(idx));
      if (c.kind === "fix" && allSel) {
        if (options?.adaptFixed && c.point) {
          kept.push({ ...c, point: transformPoint(c.point, xform) });
          adaptedConstraints++;
        } else {
          droppedConstraints++;
        }
        continue;
      }
      if ((c.kind === "horizontal" || c.kind === "vertical" || c.kind === "horizontal-distance" || c.kind === "vertical-distance") && allSel) {
        if (isParallelTurn) {
          kept.push(c);
        } else if (isQuarterTurn) {
          const swapped =
            c.kind === "horizontal" ? "vertical"
              : c.kind === "vertical" ? "horizontal"
              : c.kind === "horizontal-distance" ? "vertical-distance"
              : "horizontal-distance";
          kept.push({ ...c, kind: swapped });
          adaptedConstraints++;
        } else {
          droppedConstraints++;
        }
        continue;
      }
      if (c.kind === "line-angle" && allSel && c.value !== undefined) {
        const nextAngle = ((((c.value + angleDegrees) % 360) + 360) % 360);
        const copy = { ...c, value: nextAngle };
        delete copy.valueExpression;
        kept.push(copy);
        adaptedConstraints++;
        continue;
      }
      // Keep any constraint that still holds within tolerance after rotation.
      const res = constraintResiduals(next, c);
      if (res.every((r) => Number.isFinite(r) && Math.abs(r) < 1e-4)) {
        kept.push(c);
      } else {
        droppedConstraints++;
      }
    }
    next.constraints = kept;
  }

  validateSketchDrawing(next);
  return { drawing: next, adaptedConstraints, droppedConstraints };
}

/** Uniformly scale selected sketch contours about `center` by `factor > 0`, scaling internal
 *  length/radius dimensions proportionally and preserving orientation/tangency constraints. */
export function scaleSketchContours(
  drawing: SketchDrawing,
  selection: readonly number[],
  center: SketchPoint,
  factor: number,
  options?: { adaptFixed?: boolean },
): { drawing: SketchDrawing; scaledDimensions: number; droppedConstraints: number } {
  validateSketchDrawing(drawing);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1e5)
    throw new Error("Scale factor must be finite and greater than zero.");
  const indices = selectedContours(drawing, selection);
  const selSet = new Set(indices);
  const xform = similarityTransform(center, center, 0, factor);

  const next = structuredClone(drawing);
  for (const i of indices) next.contours[i] = transformContour(drawing.contours[i], xform);

  let scaledDimensions = 0;
  let droppedConstraints = 0;
  if (next.constraints?.length) {
    const kept: DrawingConstraint[] = [];
    for (const c of next.constraints) {
      const refs = constraintContours(c);
      const touchesSel = refs.some((idx) => selSet.has(idx));
      if (!touchesSel) {
        kept.push(c);
        continue;
      }
      const allSel = refs.every((idx) => selSet.has(idx));
      if (c.kind === "fix" && allSel) {
        if (options?.adaptFixed && c.point) {
          kept.push({ ...c, point: transformPoint(c.point, xform) });
        } else {
          droppedConstraints++;
        }
        continue;
      }
      if (allSel && SCALED_DIMENSION_KINDS.has(c.kind) && c.value !== undefined) {
        const scaled = { ...c, value: c.value * factor };
        delete scaled.valueExpression;
        kept.push(scaled);
        scaledDimensions++;
        continue;
      }
      const res = constraintResiduals(next, c);
      if (res.every((r) => Number.isFinite(r) && Math.abs(r) < 1e-4)) {
        kept.push(c);
      } else {
        droppedConstraints++;
      }
    }
    next.constraints = kept;
  }

  validateSketchDrawing(next);
  return { drawing: next, scaledDimensions, droppedConstraints };
}
