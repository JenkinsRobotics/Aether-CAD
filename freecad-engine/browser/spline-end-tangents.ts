/** Open interpolating splines with optional clamped end derivatives. The exact
 * cubic controls remain the sole geometry sent to native FreeCAD; end handles
 * are those same controls, not a second stored tangent/fit-point model. */
import { contourClosed, type SketchContour, type SketchDrawing, type SketchPoint } from '../../aether-engine/src/sketch/drawing';
import type { DrawingConstraint, SketchEntityRef } from '../../aether-engine/src/sketch/solver/types';
import { resolveSegmentReference } from '../../aether-engine/src/sketch/solver/segment-reference';

export type SplineEnd = 'start' | 'end';

export function validateSplineFreeEnds(constraint: DrawingConstraint): void {
  const ends = constraint.splineFreeEnds;
  if (ends === undefined) return;
  if (constraint.kind !== 'spline-shape' || constraint.a.kind !== 'contour' ||
      constraint.reference || constraint.b || constraint.axis ||
      !Array.isArray(ends) || !ends.length || ends.length > 2 ||
      ends.some(end => end !== 'start' && end !== 'end') || new Set(ends).size !== ends.length)
    throw Error('Independent spline tangents require unique start/end selections on a fit spline.');
}

/** Solve the standard tridiagonal C2 interpolation equations. A free end's
 * existing endpoint control supplies its derivative; an untouched end keeps
 * the previous natural (zero second derivative) boundary. */
export function splineEndTangentShape(
  path: SketchContour, spanIntervals: readonly number[] | undefined, ends: readonly SplineEnd[],
): SketchContour & { type: 'path' } {
  if (path.type !== 'path' || !path.segments.length || path.segments.some(s => s.type !== 'bezier') || contourClosed(path))
    throw Error('Independent end tangents require an open fit spline.');
  if (!ends.length || new Set(ends).size !== ends.length || ends.some(end => !['start', 'end'].includes(end)))
    throw Error('Select valid independent spline ends.');
  const points = [path.start, ...path.segments.map(s => s.end)];
  if (points.length > 1001 || points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v))))
    throw Error('Spline needs 2–1001 finite fit points.');
  const h = points.slice(1).map((p,i) => Math.hypot(p[0]-points[i][0], p[1]-points[i][1]));
  if (h.some(v => v < 1e-8)) throw Error('Consecutive spline fit points must be distinct.');
  if (spanIntervals !== undefined) {
    if (spanIntervals.length !== h.length || spanIntervals.some(v => !Number.isFinite(v) || v <= 1e-10))
      throw Error('Spline span intervals must be positive and match its segments.');
    h.splice(0, h.length, ...spanIntervals);
  }
  const first = path.segments[0], last = path.segments.at(-1)!;
  if (first.type !== 'bezier' || last.type !== 'bezier') throw Error('Select a cubic fit spline.');
  const startFree = ends.includes('start'), endFree = ends.includes('end'), n = points.length;
  const second: SketchPoint[] = points.map(() => [0,0]);
  for (const axis of [0,1] as const) {
    const diagonal: number[] = [], upper: number[] = [], rhs: number[] = [];
    for (let i = 0; i < n; i++) {
      let lower = 0, diag = 1, up = 0, force = 0;
      if (i === 0 && startFree) {
        diag = 2*h[0]; up = h[0];
        const derivative = 3*(first.controls[0][axis]-points[0][axis])/h[0];
        force = 6*((points[1][axis]-points[0][axis])/h[0]-derivative);
      } else if (i === n-1 && endFree) {
        lower = h[i-1]; diag = 2*lower;
        const derivative = 3*(points[i][axis]-last.controls[1][axis])/lower;
        force = 6*(derivative-(points[i][axis]-points[i-1][axis])/lower);
      } else if (i > 0 && i < n-1) {
        lower = h[i-1]; up = h[i]; diag = 2*(lower+up);
        force = 6*((points[i+1][axis]-points[i][axis])/up-(points[i][axis]-points[i-1][axis])/lower);
      }
      const factor = i ? lower/diagonal[i-1] : 0;
      diagonal[i] = diag-factor*(upper[i-1] ?? 0);
      upper[i] = up; rhs[i] = force-factor*(rhs[i-1] ?? 0);
    }
    for (let i = n-1; i >= 0; i--)
      second[i][axis] = (rhs[i]-upper[i]*(second[i+1]?.[axis] ?? 0))/diagonal[i];
  }
  const next = structuredClone(path);
  next.segments.forEach((s,i) => {
    if (s.type !== 'bezier') throw Error('Select a cubic fit spline.');
    for (const axis of [0,1] as const) {
      const delta = points[i+1][axis]-points[i][axis], step = h[i]*h[i];
      s.controls[0][axis] = points[i][axis]+delta/3-step*(2*second[i][axis]+second[i+1][axis])/18;
      s.controls[1][axis] = points[i+1][axis]-delta/3-step*(second[i][axis]+2*second[i+1][axis])/18;
    }
  });
  return next;
}

export function splineEndTangentResiduals(path: SketchContour, constraint: DrawingConstraint): number[] {
  validateSplineFreeEnds(constraint);
  const ends = constraint.splineFreeEnds!;
  const expected = splineEndTangentShape(path, constraint.splineSpanIntervals, ends);
  if (path.type !== 'path') throw Error('Select a fit spline.');
  return path.segments.flatMap((segment,i) => {
    const target = expected.segments[i];
    if (segment.type !== 'bezier' || target.type !== 'bezier') throw Error('Select a cubic fit spline.');
    return segment.controls.flatMap((p,j) => {
      // Independent controls are inputs, not redundant zero equations.
      if ((i === 0 && j === 0 && ends.includes('start')) ||
          (i === path.segments.length-1 && j === 1 && ends.includes('end'))) return [];
      return [p[0]-target.controls[j][0], p[1]-target.controls[j][1]];
    });
  });
}

function endpointForControl(drawing: SketchDrawing, selected: SketchEntityRef): SplineEnd | undefined {
  if (selected.kind !== 'point' || selected.control === undefined || selected.projectedContourId !== undefined) return;
  const path = drawing.contours[selected.contour];
  if (path?.type !== 'path' || contourClosed(path)) return;
  const ref = resolveSegmentReference(path, selected);
  if (ref.index === 0 && ref.control === 0) return 'start';
  if (ref.index === path.segments.length-1 && ref.control === 1) return 'end';
}

/** Enable the selected canonical end handle without changing any geometry. */
export function enableSplineEndTangent(drawing: SketchDrawing, ref: SketchEntityRef): SketchDrawing {
  const end = endpointForControl(drawing, ref);
  const shape = drawing.constraints?.find(c => c.kind === 'spline-shape' && c.a.contour === ref.contour);
  if (!end || !shape || shape.splineFreeEnds?.includes(end)) return drawing;
  const next = structuredClone(drawing), relation = next.constraints!.find(c => c.id === shape.id)!;
  relation.splineFreeEnds = (['start','end'] as const).filter(e => e === end || shape.splineFreeEnds?.includes(e));
  return next;
}

/** Pointer editing holds fit points for this gesture only. Explicitly authored
 * constraints still win: an impossible handle target rejects atomically. */
export function prepareSplineEndDrag(source: SketchDrawing, ref: SketchEntityRef) {
  const end = endpointForControl(source, ref);
  if (!end || !source.constraints?.some(c => c.kind === 'spline-shape' && c.a.contour === ref.contour)) return;
  const drawing = structuredClone(enableSplineEndTangent(source, ref)), path = drawing.contours[ref.contour];
  if (path.type !== 'path') return;
  const used = new Set(drawing.constraints!.map(c => c.id)), temporaryIds = new Set<string>();
  const hold = (point: SketchPoint, a: SketchEntityRef, label: string) => {
    let id = `spline-drag-${label}`;
    while (used.has(id)) id += '-';
    used.add(id); temporaryIds.add(id);
    drawing.constraints!.push({id,kind:'fix',a,point:[...point]});
  };
  [path.start, ...path.segments.map(s => s.end)].forEach((point,index) =>
    hold(point,{kind:'point',contour:ref.contour,index},`knot-${index}`));
  const opposite = end === 'start' ? 'end' : 'start';
  if (source.constraints!.some(c => c.kind === 'spline-shape' && c.a.contour === ref.contour && c.splineFreeEnds?.includes(opposite))) {
    const index = opposite === 'start' ? 0 : path.segments.length-1, control = opposite === 'start' ? 0 : 1;
    const segment = path.segments[index];
    if (segment.type === 'bezier') hold(segment.controls[control],{kind:'point',contour:ref.contour,index,control},'opposite-handle');
  }
  return { drawing, temporaryIds };
}
