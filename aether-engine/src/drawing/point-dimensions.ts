import type { DrawingAnnotation, DrawingPoint } from './document';
import { sheetPoint, type BuiltDrawingAnnotation, type BuiltDrawingView } from './build';
import { angularDimension, arcPolyline, arrowheadLines, linearDimension } from '../annotation/dimension-geometry';
import { sheetLines, sheetStyle } from './attached-dimensions';

type PointDimension = Extract<DrawingAnnotation, { kind: 'point-distance' | 'point-angle' }>;
/** Deduplicate shared edge endpoints, but never turn tessellation samples into
 * model vertices. Equal-distance choices are refused rather than reattached. */
export function projectedDimensionPoint(view: BuiltDrawingView, pick: DrawingPoint): DrawingPoint {
  const candidates: DrawingPoint[] = [];
  const add = (point: DrawingPoint) => {
    const value = sheetPoint(view, point);
    if (!candidates.some(other => Math.hypot(value[0] - other[0], value[1] - other[1]) < 1e-7)) candidates.push(value);
  };
  for (const curve of [...view.geometry.visible, ...(view.view.hiddenLines ? view.geometry.hidden : [])]) {
    if (curve.kind === 'line') { add(curve.start); add(curve.end); }
    if (curve.kind === 'circle' || curve.kind === 'arc') add(curve.center);
    if (curve.kind === 'arc') {
      for (const angle of [curve.start, curve.end]) {
        add([curve.center[0] + curve.radius * Math.cos(angle), curve.center[1] + curve.radius * Math.sin(angle)]);
      }
    }
  }
  const ranked = candidates.map(point => ({ point, distance: Math.hypot(point[0] - pick[0], point[1] - pick[1]) })).sort((a, b) => a.distance - b.distance);
  if (!ranked.length || ranked[0].distance > 5) throw Error('No projected endpoint or circle centre lies within 5 mm of the point pick.');
  if (ranked[1] && Math.abs(ranked[1].distance - ranked[0].distance) < 1e-7) throw Error('The point pick is ambiguous. Pick closer to one endpoint or centre.');
  return ranked[0].point;
}
export function pointDimension(annotation: PointDimension, view: BuiltDrawingView): BuiltDrawingAnnotation {
  const points = annotation.pointsMm.map(pick => projectedDimensionPoint(view, pick));
  const common = { id: annotation.id, viewId: annotation.viewId, textAlign: 'center' as const };
  if (annotation.kind === 'point-distance') {
    const [a, b] = points, delta = [b[0] - a[0], b[1] - a[1]];
    const valueMm = (annotation.axis ? Math.abs(delta[annotation.axis === 'x' ? 0 : 1]) : Math.hypot(...delta)) / view.view.scale;
    if (valueMm < 1e-9) throw Error('The selected points have zero distance along the chosen direction.');
    const text = valueMm.toFixed(annotation.decimals);
    const graphics = linearDimension(a, b, annotation.positionMm, sheetStyle, annotation.axis);
    return { ...common, text, valueMm, measure: 'length', positionMm: graphics.text.at, lines: sheetLines(graphics, text) };
  }
  const [a, vertex, b] = points;
  const v1: DrawingPoint = [a[0] - vertex[0], a[1] - vertex[1]], v2: DrawingPoint = [b[0] - vertex[0], b[1] - vertex[1]];
  const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
  if (Math.min(l1, l2) < 1e-9) throw Error('An angle needs three distinct points.');
  const r1: DrawingPoint = [v1[0] / l1, v1[1] / l1], r2: DrawingPoint = [v2[0] / l2, v2[1] / l2];
  const cross = r1[0] * r2[1] - r1[1] * r2[0];
  if (Math.abs(cross) < 1e-9) throw Error('An angle needs three non-collinear points.');
  const valueDeg = Math.acos(Math.max(-1, Math.min(1, r1[0] * r2[0] + r1[1] * r2[1]))) * 180 / Math.PI;
  const graphics = angularDimension(vertex, r1, r2, Math.sign(cross) as 1 | -1, annotation.positionMm, sheetStyle, [l1, l2]);
  return { ...common, text: `${valueDeg.toFixed(annotation.decimals)}°`, valueDeg, measure: 'angle', positionMm: graphics.text.at,
    lines: [...graphics.extensions, ...arcPolyline(graphics.arc), ...graphics.arrows.flatMap(arrow => arrowheadLines(arrow, sheetStyle))] };
}
