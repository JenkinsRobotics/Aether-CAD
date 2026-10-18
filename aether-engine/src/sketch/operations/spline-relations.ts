import { validateSketchDrawing, type SketchDrawing } from "../drawing";
import { splineShapeResiduals } from "../solver/spline-shape";
import { splineEndTangentResiduals } from "../../../../freecad-engine/browser/spline-end-tangents";
/** Retain interpolation intent using the native contour's existing vertices. */
export function constrainFitSpline(
  source: SketchDrawing,
  contour: number,
): SketchDrawing {
  const next = structuredClone(source),
    path = next.contours[contour];
  const existing = next.constraints?.find(c => c.kind === 'spline-shape' && c.a.contour === contour);
  if (!path || (existing?.splineFreeEnds ? splineEndTangentResiduals(path, existing) : splineShapeResiduals(path, existing?.splineSpanIntervals)).some((v) => Math.abs(v) > 1e-6))
    throw Error("Select an interpolated fit spline.");
  const constraints = (next.constraints ??= []);
  if (
    !constraints.some(
      (c) => c.kind === "spline-shape" && c.a.contour === contour,
    )
  ) {
    let id = "spline-shape";
    while (constraints.some((c) => c.id === id)) id += "-";
    constraints.push({
      id,
      kind: "spline-shape",
      a: { kind: "contour", contour },
    });
  }
  validateSketchDrawing(next);
  return next;
}
