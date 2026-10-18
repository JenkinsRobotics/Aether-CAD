/** Browser preview of the native Sketcher Block contract. The saved Fix owns
 * its geometric target; the existing solver supplies numerical iteration.
 * No hidden dimensions or additional construction geometry are persisted. */
import { contourClosed, validateSketchDrawing, type SketchContour, type SketchDrawing, type SketchPoint } from '../../aether-engine/src/sketch/drawing';
import { sketchArcGeometry } from '../../aether-engine/src/sketch/arc-geometry';
import { resolve } from '../../aether-engine/src/sketch/solver/entities';
import { resolveSegmentReference } from '../../aether-engine/src/sketch/solver/segment-reference';
import type { DrawingConstraint, SketchEntityRef } from '../../aether-engine/src/sketch/solver/types';

export function fixedEntityGeometry(drawing: SketchDrawing, ref: SketchEntityRef): SketchContour {
  if (ref.projectedContourId !== undefined) throw Error('Projected geometry is already read-only. Fix authored geometry instead.');
  resolve(drawing, ref);
  const contour = drawing.contours[ref.contour];
  ref = resolveSegmentReference(contour, ref);
  if (ref.kind === 'point') throw Error('A point Fix uses its point target.');
  if (contour.type === 'circle' || ref.kind === 'contour') return structuredClone(contour);
  const segment = contour.segments[ref.index!];
  if (!segment) throw Error('Fix references a missing curve.');
  return { type: 'path', start: [...(ref.index === 0 ? contour.start : contour.segments[ref.index! - 1].end)], segments: [structuredClone(segment)] };
}

export function fixedEntityConstraint(drawing: SketchDrawing, ref: SketchEntityRef): DrawingConstraint {
  if (ref.projectedContourId !== undefined) throw Error('Projected geometry is already read-only. Fix authored geometry instead.');
  const entity = resolve(drawing, ref);
  // An interpolated spline and a full ellipse are single authored entities,
  // although their exact representation contains multiple spans.
  if (ref.kind !== 'point' && drawing.constraints?.some(c =>
    ['spline-shape', 'ellipse-shape'].includes(c.kind) && c.a.contour === ref.contour)) ref = { kind: 'contour', contour: ref.contour };
  return { id: crypto.randomUUID(), kind: 'fix', a: structuredClone(ref),
    ...(ref.kind === 'point' && entity.point ? { point: [...entity.point] as SketchPoint } : { fixedGeometry: fixedEntityGeometry(drawing, ref) }) };
}

/** One residual per saved geometric coordinate. Branch flags and topology must
 * match; changing topology requires removing the affected Fix first. */
export function fixedGeometryResiduals(drawing: SketchDrawing, constraint: DrawingConstraint): number[] {
  if (constraint.kind !== 'fix' || constraint.point !== undefined || constraint.b || constraint.axis || constraint.reference || constraint.value !== undefined || constraint.valueFrom !== undefined || constraint.valueExpression !== undefined)
    throw Error('A whole-entity Fix cannot also contain point, pair or dimension fields.');
  const target = constraint.fixedGeometry;
  if (!target || !['circle', 'path'].includes(target.type)) throw Error('Fix needs valid saved geometry.');
  validateSketchDrawing({ type: 'drawing', contours: [target] });
  const current = fixedEntityGeometry(drawing, constraint.a);
  const mismatch = () => { throw Error('Fixed geometry changed type or topology. Unfix it before changing its topology.'); };
  const point = (a: SketchPoint, b: SketchPoint) => [a[0] - b[0], a[1] - b[1]];
  if (current.type === 'circle' && target.type === 'circle') return [...point(current.center, target.center), current.radius - target.radius];
  if (current.type !== 'path' || target.type !== 'path' || current.segments.length !== target.segments.length) return mismatch();
  const residual = point(current.start, target.start);
  for (let i = 0; i < current.segments.length; i++) {
    const a = current.segments[i], b = target.segments[i];
    if (a.type !== b.type) return mismatch();
    residual.push(...point(a.end, b.end));
    if (a.type === 'arc' && b.type === 'arc') residual.push(...point(a.middle, b.middle));
    if (a.type === 'bezier' && b.type === 'bezier') for (const j of [0,1]) residual.push(...point(a.controls[j], b.controls[j]));
    if (a.type === 'conic' && b.type === 'conic') residual.push(...point(a.control,b.control),a.rho-b.rho);
    if (a.type === 'ellipse' && b.type === 'ellipse') {
      if (a.largeArc !== b.largeArc || a.sweep !== b.sweep) return mismatch();
      const rotation = (a.rotationDegrees - b.rotationDegrees) * Math.PI / 180;
      residual.push(a.radiusX - b.radiusX, a.radiusY - b.radiusY, Math.atan2(Math.sin(rotation), Math.cos(rotation)) * Math.max(b.radiusX,b.radiusY));
    }
  }
  return residual;
}

/** Diagnostics count independent geometric freedoms. The solver still checks
 * every saved coordinate above; aliased closed endpoints and a circular arc's
 * through-point parameter must not falsely label a single Fix as redundant.
 * Shape constraints retain their own equations, so Fix contributes the input
 * degrees of freedom of those whole entities (fit knots / ellipse frame). */
export function fixedGeometryDiagnosticResiduals(drawing: SketchDrawing, constraint: DrawingConstraint): number[] {
  const full = fixedGeometryResiduals(drawing, constraint);
  const a = fixedEntityGeometry(drawing, constraint.a), b = constraint.fixedGeometry!;
  if (a.type !== 'path' || b.type !== 'path') return full;
  const point = (p: SketchPoint, q: SketchPoint) => [p[0]-q[0],p[1]-q[1]];
  const shape = constraint.a.kind === 'contour' && drawing.constraints?.find(c =>
    ['spline-shape','ellipse-shape'].includes(c.kind) && c.a.contour === constraint.a.contour);
  if (shape && shape.kind === 'ellipse-shape') {
    const x=a.segments[0], y=b.segments[0];
    if (x.type !== 'ellipse' || y.type !== 'ellipse') return full;
    const center = (p: typeof a): SketchPoint => [(p.start[0]+p.segments[0].end[0])/2,(p.start[1]+p.segments[0].end[1])/2];
    const rotation=(x.rotationDegrees-y.rotationDegrees)*Math.PI/180;
    return [...point(center(a),center(b)),x.radiusX-y.radiusX,x.radiusY-y.radiusY,Math.atan2(Math.sin(rotation),Math.cos(rotation))*Math.max(y.radiusX,y.radiusY)];
  }
  const residual=point(a.start,b.start), closed=contourClosed(b);
  let startA=a.start,startB=b.start;
  for (let i=0;i<a.segments.length;i++) {
    const x=a.segments[i], y=b.segments[i];
    if (!(closed && i===a.segments.length-1)) residual.push(...point(x.end,y.end));
    if (!shape) {
      if (x.type==='arc' && y.type==='arc') {
        const first=sketchArcGeometry(startA,x.middle,x.end), second=sketchArcGeometry(startB,y.middle,y.end);
        residual.push((Math.tan(first.sweep/4)-Math.tan(second.sweep/4))*Math.hypot(y.end[0]-startB[0],y.end[1]-startB[1]));
      }
      if (x.type==='bezier' && y.type==='bezier') for (const j of [0,1]) residual.push(...point(x.controls[j],y.controls[j]));
      if (x.type==='conic' && y.type==='conic') residual.push(...point(x.control,y.control),x.rho-y.rho);
      if (x.type==='ellipse' && y.type==='ellipse') {
        const rotation=(x.rotationDegrees-y.rotationDegrees)*Math.PI/180;
        residual.push(x.radiusX-y.radiusX,x.radiusY-y.radiusY,Math.atan2(Math.sin(rotation),Math.cos(rotation))*Math.max(y.radiusX,y.radiusY));
      }
    }
    if (shape && shape.kind === 'spline-shape' && x.type === 'bezier' && y.type === 'bezier') {
      if (i === 0 && shape.splineFreeEnds?.includes('start')) residual.push(...point(x.controls[0], y.controls[0]));
      if (i === a.segments.length-1 && shape.splineFreeEnds?.includes('end')) residual.push(...point(x.controls[1], y.controls[1]));
    }
    startA=x.end;startB=y.end;
  }
  return residual;
}

/** Native geometry indices are local to each translated contour. */
export function blockedSketchGeometry(drawing: SketchDrawing, contourIndex: number): number[] {
  const contour = drawing.contours[contourIndex], indices = new Set<number>();
  for (const c of drawing.constraints ?? []) {
    if (c.kind !== 'fix' || !c.fixedGeometry || c.a.contour !== contourIndex || c.a.projectedContourId !== undefined) continue;
    if (Math.max(...fixedGeometryResiduals(drawing, c).map(Math.abs)) > 1e-6) throw Error('Fixed geometry is not at its saved position. Solve the sketch before rebuilding.');
    if (contour.type === 'circle') indices.add(0);
    else if (c.a.kind === 'contour') contour.segments.forEach((_, index) => indices.add(index));
    else indices.add(resolveSegmentReference(contour, c.a).index!);
  }
  return [...indices].sort((a,b) => a-b);
}

export function fixedConstraintMatches(drawing: SketchDrawing, constraint: DrawingConstraint, selected: SketchEntityRef): boolean {
  if (constraint.kind !== 'fix' || selected.projectedContourId !== undefined || constraint.a.projectedContourId !== undefined || selected.contour !== constraint.a.contour) return false;
  const contour = drawing.contours[selected.contour];
  if (!contour) return false;
  let a: SketchEntityRef, b: SketchEntityRef;
  try { a = resolveSegmentReference(contour, constraint.a); b = resolveSegmentReference(contour, selected); }
  catch { return false; } // A stale transient selection must not break the editor.
  if (selected.kind === 'contour') return true;
  if (constraint.fixedGeometry && a.kind === 'contour') return true;
  if (contour.type === 'circle' && constraint.fixedGeometry) return true;
  if (constraint.fixedGeometry && a.kind !== 'point' && b.kind === 'point') {
    return b.control !== undefined ? b.index === a.index : b.index === a.index || b.index === a.index! + 1;
  }
  if (a.kind === 'point' || b.kind === 'point') return a.kind === b.kind && a.index === b.index && a.control === b.control;
  return a.index === b.index;
}
