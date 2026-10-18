import { resolve, type DrawingConstraint, type SketchDrawing, type SketchEntityRef, type SketchPoint } from '@aether/core/sketch';

/** Infer a measurement from geometry and label placement; no saved state until confirmation. */
export function inferDimension(drawing: SketchDrawing, refs: SketchEntityRef[], position: SketchPoint, id: string): DrawingConstraint | undefined {
  if (!refs.length) return;
  let [a, b] = refs;
  const contour=drawing.contours[a.contour];
  if (!b && a.kind==='curve'&&contour?.type==='path'&&contour.segments[a.index!]?.type==='conic') return {id,kind:'conic-rho',a};
  const first = resolve(drawing, a);
  if (!b) {
    if (first.circle && a.kind !== 'point') return { id, kind: a.kind === 'arc' ? 'radius' : 'diameter', a };
    if (first.line) return { id, kind: 'length', a };
    return;
  }
  // Circles paired with another item contribute their centers.
  if (a.kind === 'circle') a = { ...a, kind: 'point', index: 0 };
  if (b.kind === 'circle') b = { ...b, kind: 'point', index: 0 };
  const aa = resolve(drawing, a), bb = resolve(drawing, b);
  if (aa.line && bb.line) {
    const u = [aa.line[1][0] - aa.line[0][0], aa.line[1][1] - aa.line[0][1]];
    const v = [bb.line[1][0] - bb.line[0][0], bb.line[1][1] - bb.line[0][1]];
    const parallel = Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-7 * Math.hypot(...u) * Math.hypot(...v);
    return { id, kind: parallel ? 'distance' : 'angle', a, b };
  }
  if (aa.point && bb.point) {
    const p = aa.point, q = bb.point;
    const dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]);
    const outsideX = position[0] < Math.min(p[0], q[0]) || position[0] > Math.max(p[0], q[0]);
    const outsideY = position[1] < Math.min(p[1], q[1]) || position[1] > Math.max(p[1], q[1]);
    const kind = dy > 1e-7 && outsideX && !outsideY ? 'vertical-distance'
      : dx > 1e-7 && outsideY && !outsideX ? 'horizontal-distance' : 'distance';
    return { id, kind, a, b };
  }
  if ((aa.point && bb.line) || (aa.line && bb.point)) return { id, kind: 'distance', a, b };
  throw Error('Select a line, circle, arc, two points, or two lines.');
}
