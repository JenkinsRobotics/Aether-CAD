import { sketchNodeLabel } from "./point-roles";
import { sketchFaceRegions } from '../../freecad-engine/browser/connected-sketch-regions';
import { pointInPolygon, polygonArea, distanceToSegment } from '@aether/sketch';
import {
  pickCurve,
  sketchArcGeometry,
  sketchContourPolyline,
  sketchEntities,
  sketchEntityPoint,
  type SketchPoint,
  type SketchDrawing,
} from "@aether/core/sketch";
export function pickSketchEntity(drawing: SketchDrawing, p: SketchPoint) {
  const distance = (a: SketchPoint) => Math.hypot(a[0] - p[0], a[1] - p[1]);
  const candidates = sketchEntities(drawing)
    .map((entity) => {
      const c = drawing.contours[entity.ref.contour],
        r = entity.ref;
      let d = Infinity;
      if (c.type === "circle")
        d =
          r.kind === "point"
            ? distance(c.center)
            : Math.abs(distance(c.center) - c.radius);
      else if (r.kind === "point") {
        const point = sketchEntityPoint(drawing, r);
        if (point) d = distance(point);
      } else if (r.kind === "arc" && c.type === "path") {
        const segment = c.segments[r.index!];
        if (segment.type === "arc") {
          const start = r.index === 0 ? c.start : c.segments[r.index! - 1].end,
            arc = sketchArcGeometry(start, segment.middle, segment.end);
          const angle = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]),
            tau = 2 * Math.PI;
          const delta =
            arc.sweep >= 0
              ? (angle - arc.startAngle + tau) % tau
              : (arc.startAngle - angle + tau) % tau;
          d =
            delta <= Math.abs(arc.sweep)
              ? Math.abs(distance(arc.center) - arc.radius)
              : Math.min(distance(start), distance(segment.end));
        }
      } else if (r.kind === "line") {
        const a = r.index === 0 ? c.start : c.segments[r.index! - 1].end,
          b = c.segments[r.index!].end;
        d = distanceToSegment(p, a, b);
      }
      return { ...entity, label: sketchNodeLabel(drawing, r, entity.label), d };
    })
    .sort((a, b) => {
      // A construction point on a curve must remain pickable even when the
      // curve precedes it in document order. Ignore numerical distance noise.
      if (Math.abs(a.d - b.d) < 1e-7)
        return Number(b.ref.kind === "point") - Number(a.ref.kind === "point");
      return a.d - b.d;
    });
  try {
    const curve = pickCurve(drawing, p, Infinity),
      contour = drawing.contours[curve.contour];
    if (
      !curve.circle &&
      !curve.point &&
      contour.type === "path" &&
      ["bezier", "ellipse", "conic"].includes(contour.segments[curve.segment].type) &&
      (!candidates[0] || curve.distance < candidates[0].d - 1e-7)
    )
      return {
        ref: {
          contour: curve.contour,
          kind: "curve" as const,
          index: curve.segment,
          parameter: curve.parameter,
        },
        label: `${curve.contour + 1}: Segment ${curve.segment + 1}`,
        d: curve.distance,
      };
  } catch {
    /* Empty sketches have no selectable curves. */
  }
  return candidates[0];
}

/** Which closed region the point falls inside, innermost first, or null.
 *
 *  Edges and vertices are picked by proximity; a region is picked by being
 *  *in* it, which is what makes the shaded interiors selectable at all. The
 *  smallest containing region wins, so a shape drawn inside another can still
 *  be picked. Construction and open contours bound nothing and are skipped.
 */
export function pickSketchRegion(
  drawing: SketchDrawing,
  p: SketchPoint,
): number | null {
  let best: number | null = null;
  let smallest = Infinity;
  sketchFaceRegions(drawing).forEach(({ contour, contourIndex: index }) => {
    const outline = sketchContourPolyline(contour);
    if (!pointInPolygon(outline, p)) return;
    const area = Math.abs(polygonArea(outline));
    if (area < smallest) {
      smallest = area;
      best = index;
    }
  });
  return best;
}
