import type { SketchDrawing, SketchPoint } from "../drawing";
import { curveIntersections, type Curve } from "../curves/pairs";
import { closestSegmentParameter, segmentPoint } from "../curves/parameterization";
import { splitSketchSegment } from "./split";

/** Every exact curve of the drawing; a circle counts as its two half arcs. */
function drawingCurves(drawing: SketchDrawing): { contour: number; segment: number; curve: Curve }[] {
  const out: { contour: number; segment: number; curve: Curve }[] = [];
  drawing.contours.forEach((c, contour) => {
    if (c.type === "path") {
      let start = c.start;
      c.segments.forEach((segment, index) => { out.push({ contour, segment: index, curve: { start, segment } }); start = segment.end; });
    } else if (c.type === "circle") {
      const [cx, cy] = c.center, r = c.radius;
      out.push({ contour, segment: 0, curve: { start: [cx + r, cy], segment: { type: "arc", middle: [cx, cy + r], end: [cx - r, cy] } } });
      out.push({ contour, segment: 1, curve: { start: [cx - r, cy], segment: { type: "arc", middle: [cx, cy - r], end: [cx + r, cy] } } });
    }
  });
  return out;
}

/** SolidCraft's `sketch.break`: split the curve nearest `point` at every place another curve
 *  crosses it, in one go. Crossings at its ends are not breaks. Point constraints survive as
 *  they do for Split, which this applies once per crossing. */
export function breakSketchCurveAtIntersections(drawing: SketchDrawing, point: SketchPoint, tolerance: number): SketchDrawing {
  const curves = drawingCurves(drawing);
  let target: (typeof curves)[number] | undefined, best = tolerance;
  for (const entry of curves) {
    if (drawing.contours[entry.contour].type !== "path") continue;
    const closest = closestSegmentParameter(entry.curve.start, entry.curve.segment, point);
    if (closest.distance < best) { best = closest.distance; target = entry; }
  }
  if (!target) throw new Error("Click a line, arc, ellipse segment or Bezier curve to break.");
  const crossings: SketchPoint[] = [];
  for (const other of curves) {
    if (other.contour === target.contour && other.segment === target.segment) continue;
    for (const hit of curveIntersections(target.curve, other.curve)) {
      const endA = segmentPoint(target.curve.start, target.curve.segment, 0), endB = segmentPoint(target.curve.start, target.curve.segment, 1);
      const atEnd = (p: SketchPoint) => Math.hypot(p[0] - hit.point[0], p[1] - hit.point[1]) < 1e-6;
      if (atEnd(endA) || atEnd(endB)) continue;
      if (crossings.some((p) => Math.hypot(p[0] - hit.point[0], p[1] - hit.point[1]) < 1e-6)) continue;
      crossings.push(hit.point);
    }
  }
  if (!crossings.length) throw new Error("No other curve crosses this one.");
  // Each split finds the piece under its point again, so the order does not matter.
  return crossings.reduce((next, p) => splitSketchSegment(next, p, 1e-6), drawing);
}
