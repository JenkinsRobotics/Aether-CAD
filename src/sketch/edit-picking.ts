import type { SketchDrawing, SketchPoint, SketchEntityRef } from '@aether/core/sketch';
import { ellipseHandles, type EllipseHandle } from '../../freecad-engine/browser/ellipse-manipulation';
import { conicHandles, type ConicHandle } from '../../freecad-engine/browser/conic-manipulation';
import { pickSelectableSketchEntity } from './projected-picking';

/** Edit-only handles must not create false constraint or snapping entities. */
export function pickSketchEditEntity(drawing: SketchDrawing, point: SketchPoint, svg: SVGSVGElement):
  { ref: SketchEntityRef; label: string; d: number; ellipseHandle?: EllipseHandle; conicHandle?: ConicHandle } | undefined {
  const geometry = pickSelectableSketchEntity(drawing, point);
  const offset = Number(svg.dataset.ellipseHandleOffset) || 6;
  const handles = [
    ...ellipseHandles(drawing, offset).map(h => ({ ref: h.ref, label: h.label, point: h.point, ellipseHandle: h })),
    ...conicHandles(drawing).map(h => ({ ref: h.ref, label: h.label, point: h.point, conicHandle: h })),
  ];
  const handle = handles.map(h => ({ ...h, d: Math.hypot(h.point[0] - point[0], h.point[1] - point[1]) })).sort((a, b) => a.d - b.d)[0];
  if (!handle) return geometry;
  const sameGeometry = geometry?.ref.projectedContourId === undefined && geometry?.ref.contour === handle.ref.contour &&
    ('conicHandle' in handle ? geometry.ref.kind !== 'point' && geometry.ref.index === handle.ref.index : true);
  if (!geometry || handle.d < geometry.d - 1e-7 || (sameGeometry && Math.abs(handle.d - geometry.d) < 1e-7)) return handle;
  return geometry;
}
