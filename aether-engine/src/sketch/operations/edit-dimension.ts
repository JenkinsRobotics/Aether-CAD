import { validateSketchDrawing, type SketchDrawing, type SketchPoint } from "../drawing";
import {
  resolveDimensionLink,
  preserveRemovedDimensionDrivers,
  dimensionUnit,
} from "../solver/dimension-links";
import { measuredDimensionValue } from "../solver/measured-dimension";
import { solveDrawingConstraints } from "../solver/solve";

function scaleDrawingUniformly(d: SketchDrawing, factor: number, origin: SketchPoint): void {
  const scalePt = (p: SketchPoint) => {
    p[0] = origin[0] + (p[0] - origin[0]) * factor;
    p[1] = origin[1] + (p[1] - origin[1]) * factor;
  };
  for (const c of d.contours) {
    if (c.type === "circle") {
      scalePt(c.center);
      c.radius *= factor;
    } else {
      scalePt(c.start);
      for (const s of c.segments) {
        scalePt(s.end);
        if (s.type === "arc") scalePt(s.middle);
        if (s.type === "bezier") s.controls.forEach(scalePt);
        if (s.type === "conic") scalePt(s.control);
        if (s.type === "ellipse") {
          s.radiusX *= factor;
          s.radiusY *= factor;
        }
      }
    }
  }
}

function sketchPivot(d: SketchDrawing): SketchPoint {
  const fixed = d.constraints?.find((c) => c.kind === "fix" && c.point);
  if (fixed?.point) return [...fixed.point];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const visit = (p: SketchPoint) => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  };
  for (const c of d.contours) {
    if (c.type === "circle") {
      visit([c.center[0] - c.radius, c.center[1] - c.radius]);
      visit([c.center[0] + c.radius, c.center[1] + c.radius]);
    } else {
      visit(c.start);
      for (const s of c.segments) visit(s.end);
    }
  }
  return Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : [0, 0];
}

/** Editing a follower edits its shared driver, so every linked dimension stays consistent.
 *  When `options.autoScaleFirst` is true and this is the sketch's sole driving length dimension,
 *  the entire sketch scales uniformly before solving so freehand profiles never invert. */
export function editDrawingDimension(
  source: SketchDrawing,
  id: string,
  value: number,
  options: { autoScaleFirst?: boolean } = {},
): SketchDrawing {
  const next = structuredClone(source),
    constraint = next.constraints?.find((c) => c.id === id);
  if (!constraint) throw new Error("Select an existing dimension.");
  if (!Number.isFinite(value))
    throw new Error("Enter a finite dimension value.");
  const { driver, sign, offset } = resolveDimensionLink(next, constraint);
  if (driver.valueExpression !== undefined)
    throw Error(
      "Edit or remove the dimension formula before entering a numeric value.",
    );
  const newDriverValue = (value - offset) / sign;
  if (options.autoScaleFirst && dimensionUnit(driver) === "length" && newDriverValue > 0) {
    const drivingLengths = (next.constraints ?? []).filter((c) => !c.reference && dimensionUnit(c) === "length");
    if (drivingLengths.length === 1 && drivingLengths[0].id === driver.id) {
      let current = driver.value ?? 0;
      try {
        current = Math.abs(measuredDimensionValue(next, { ...driver, reference: true, value: undefined, valueExpression: undefined }));
      } catch { /* fall back to stored value */ }
      if (current > 1e-6) {
        const factor = newDriverValue / current;
        if (Number.isFinite(factor) && factor > 1e-4 && factor < 1e4) {
          scaleDrawingUniformly(next, factor, sketchPivot(next));
        }
      }
    }
  }
  driver.value = newDriverValue;
  const solved = solveDrawingConstraints(next);
  validateSketchDrawing(solved);
  return solved;
}
export function removeDrawingConstraint(
  source: SketchDrawing,
  id: string,
): SketchDrawing {
  const next = structuredClone(source);
  next.constraints = next.constraints?.filter((c) => c.id !== id);
  preserveRemovedDimensionDrivers(source, next);
  validateSketchDrawing(next);
  return next;
}
