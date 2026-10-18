import { validateSketchDrawing, type SketchDrawing, type SketchPoint } from '../../aether-engine/src/sketch/drawing';
import { conicRhoAtPoint, validateConic, type ConicSegment } from './conic-geometry';

export interface ConicRhoInput { value: number; expression?: string }

/** Endpoints, tangent intersection, then a point projected onto the rho axis.
 * Preview and commit use this same exact rational quadratic. */
export function conicPlacement(points: readonly SketchPoint[], rho?: ConicRhoInput) {
  if (points.length < 3 || points.length > 4) throw Error('Choose both endpoints and the tangent control first.');
  const [start, end, control, handle] = points;
  const segment: ConicSegment = { type: 'conic', end: [...end], control: [...control], rho: .5 };
  validateConic(start, segment);
  segment.rho = rho?.value ?? (handle ? conicRhoAtPoint(start, segment, handle) : .5);
  validateConic(start, segment);
  return { type: 'path' as const, start: [...start] as SketchPoint, segments: [segment] };
}

/** A completed gesture is one atomic drawing edit with an ordinary rho driver. */
export function createSketchConic(source: SketchDrawing, points: readonly SketchPoint[], construction = false, rho?: ConicRhoInput): SketchDrawing {
  if (points.length !== 4 && !(points.length === 3 && rho)) throw Error('Set conic curvature with the fourth point or enter rho.');
  const contour = conicPlacement(points, rho), drawing = structuredClone(source);
  drawing.contours.push({ ...contour, ...(construction ? { construction: true } : {}) });
  const constraints = drawing.constraints ??= [];
  let id = 1;
  while (constraints.some(c => c.id === `conic-rho-${id}`)) id++;
  constraints.push({ id: `conic-rho-${id}`, kind: 'conic-rho', a: { contour: drawing.contours.length - 1, kind: 'curve', index: 0 }, value: contour.segments[0].rho, ...(rho?.expression ? { valueExpression: rho.expression } : {}) });
  validateSketchDrawing(drawing);
  return drawing;
}
