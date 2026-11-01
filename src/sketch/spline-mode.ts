import { constrainFitSpline, controlPointSpline, fitSketchSpline, type SketchContour, type SketchDrawing, type SketchPoint } from "@aether/core/sketch";

/** Which curve the spline tool builds from its clicked points: a fit spline through them, or a
 *  control-point B-spline of degree 3 or 5 (SolidCraft's sketch.spline.control_point[_5]).
 *  One holder shared by the workspace, the tool, the drawing step and the preview. */
export const splineMode: { value: "fit" | 3 | 5 } = { value: "fit" };
export const splineToolNames = { "control-spline": 3 } as const;

/** The curve the current mode makes from the points; closed joins the last point to the first. */
export function splineContour(points: readonly SketchPoint[], closed: boolean): SketchContour {
  if (splineMode.value === "fit") return fitSketchSpline([...points], { closed });
  return controlPointSpline(closed ? [...points, points[0]] : points, splineMode.value);
}
/** Commit the curve: a fit spline also gets its shape relations, a control spline does not. */
export function addSplineContour(drawing: SketchDrawing, contour: SketchContour): SketchDrawing {
  const next = structuredClone(drawing);
  next.contours.push(contour);
  return splineMode.value === "fit" ? constrainFitSpline(next, next.contours.length - 1) : next;
}
