import { resolve, sketchContourPolyline, type SketchDrawing, type SketchEntityRef, type SketchPoint, type DrawingConstraint } from "@aether/core/sketch";
import { contourPath } from "./svg-geometry";

export function constraintParticipants(constraint: DrawingConstraint): SketchEntityRef[] {
  return [constraint.a, constraint.b, constraint.axis].filter((ref): ref is SketchEntityRef => !!ref);
}

/** Project exact model references into disposable SVG geometry. Resolving through
 * Core first preserves stable reference validation, including projected entities. */
export function constraintGeometry(drawing: SketchDrawing, ref: SketchEntityRef, pointRadius: number) {
  try {
    const entity = resolve(drawing, ref);
    if (entity.point) return { anchor: entity.point, tag: "circle", attrs: { cx: entity.point[0], cy: -entity.point[1], r: pointRadius } };
    const circle = entity.circle ?? (entity.contour?.type === "circle" ? entity.contour : undefined);
    if (circle && !entity.arc) {
      const { center, radius } = circle;
      return { anchor: [center[0] + radius * Math.SQRT1_2, center[1] + radius * Math.SQRT1_2] as SketchPoint,
        tag: "circle", attrs: { cx: center[0], cy: -center[1], r: radius } };
    }
    const contour = ref.projectedContourId === undefined ? drawing.contours[ref.contour]
      : drawing.projectionContext?.find(c => c.id === ref.projectedContourId);
    if (contour?.type !== "path") return null;
    // Core has validated the stable segment ID. Use its position only to draw
    // the referenced segment, never the entire owning path.
    const index = ref.segmentId === undefined ? ref.index : contour.segments.findIndex(s => s.id === ref.segmentId);
    const segment = index === undefined ? undefined : contour.segments[index];
    const shape = ref.kind === "contour" ? contour : segment ? {
      type: "path" as const, start: index === 0 ? contour.start : contour.segments[index! - 1].end, segments: [segment],
    } : null;
    if (!shape) return null;
    const points = sketchContourPolyline(shape);
    const anchor = entity.curve?.point ?? entity.arc?.midpoint ?? (
      entity.line ? [(entity.line[0][0] + entity.line[1][0]) / 2, (entity.line[0][1] + entity.line[1][1]) / 2] as SketchPoint
      : points[Math.floor(points.length / 2)]);
    return { anchor, tag: "path", attrs: { d: contourPath(shape) } };
  } catch { return null; } // Broken references stay diagnostics, never guessed targets.
}
