import { contourClosed, type SketchContour, type SketchPoint } from '../drawing';
import { curveJet } from './derivatives';
import { lineSegmentIntersections } from './intersections';
import { closestSegmentParameter } from './parameterization';

export type ContourContainment = 'inside' | 'outside' | 'boundary' | 'ambiguous';
const tolerance = 1e-7;

/** Classify against authored curves, never the display tessellation. A ray
 * through a vertex or tangent is retried in another deterministic direction.
 * An unresolved numerical case stays unselectable rather than picking a hole. */
export function classifySketchContourPoint(contour: SketchContour, point: SketchPoint): ContourContainment {
  if (point.some(v => !Number.isFinite(v))) return 'ambiguous';
  if (!contourClosed(contour) || contour.construction) return 'outside';
  if (contour.type === 'circle') {
    const gap = Math.hypot(point[0] - contour.center[0], point[1] - contour.center[1]) - contour.radius;
    return Math.abs(gap) <= tolerance ? 'boundary' : gap < 0 ? 'inside' : 'outside';
  }
  let start = contour.start;
  const curves = contour.segments.map(segment => {
    const curve = {start, segment};
    start = segment.end;
    return {...curve, jet: curveJet(curve)};
  });
  if (curves.some(c => closestSegmentParameter(c.start, c.segment, point).distance <= tolerance)) return 'boundary';
  rays: for (let attempt = 0; attempt < 12; attempt++) {
    const angle = attempt * 2.399963229728653, direction = [Math.cos(angle), Math.sin(angle)];
    const end: SketchPoint = [point[0] + direction[0], point[1] + direction[1]];
    let crossings = 0;
    for (const c of curves) {
      const dx = c.start[0] - point[0], dy = c.start[1] - point[1];
      if (dx * direction[0] + dy * direction[1] >= 0 && Math.abs(dx * direction[1] - dy * direction[0]) <= tolerance) continue rays;
      for (const distance of lineSegmentIntersections(point, end, c.start, c.segment)) {
        if (distance <= 0) continue;
        const hit: SketchPoint = [point[0] + distance * direction[0], point[1] + distance * direction[1]];
        const nearest = closestSegmentParameter(c.start, c.segment, hit);
        if (nearest.distance > tolerance) continue rays;
        const tangent = c.jet(nearest.parameter).first, length = Math.hypot(...tangent);
        if (length < tolerance || Math.abs(tangent[0] * direction[1] - tangent[1] * direction[0]) <= length * 1e-7) continue rays;
        crossings++;
      }
    }
    return crossings % 2 ? 'inside' : 'outside';
  }
  return 'ambiguous';
}
