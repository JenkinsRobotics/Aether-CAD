/** Curvature handles are derived from the exact curve, never saved as nodes. */
import { validateSketchDrawing, type SketchDrawing, type SketchPoint } from '../../aether-engine/src/sketch/drawing';
import { resolveDimensionLink } from '../../aether-engine/src/sketch/solver/dimension-links';
import { resolveSegmentReference } from '../../aether-engine/src/sketch/solver/segment-reference';
import { solveDrawingConstraints } from '../../aether-engine/src/sketch/solver/solve';
import type { SketchEntityRef } from '../../aether-engine/src/sketch/solver/types';
import { conicKind, conicPoint, conicRhoAtPoint } from './conic-geometry';
import { referencedConic } from './conic-constraints';
import { fixedEntityConstraint, fixedGeometryResiduals } from './fixed-geometry';

export interface ConicHandle {
  ref: SketchEntityRef;
  point: SketchPoint;
  midpoint: SketchPoint;
  control: SketchPoint;
  label: string;
}

export function conicHandles(drawing: SketchDrawing): ConicHandle[] {
  return drawing.contours.flatMap((path, contour) => {
    if (path.type !== 'path') return [];
    return path.segments.flatMap((segment, index) => {
      if (segment.type !== 'conic') return [];
      const start = index ? path.segments[index - 1].end : path.start;
      return [{ ref: { contour, kind: 'curve' as const, index, parameter: .5, ...(segment.id ? { segmentId: segment.id } : {}) },
        point: conicPoint(start, segment, .5),
        midpoint: [(start[0] + segment.end[0]) / 2, (start[1] + segment.end[1]) / 2] as SketchPoint,
        control: [...segment.control] as SketchPoint,
        label: `Conic curvature · ρ ${Number(segment.rho.toFixed(6))} · ${conicKind(segment.rho)}` }];
    });
  });
}

/** A literal or linked driver is edited in place. Formulas and Fix remain
 * authoritative. A transient target holds this segment's endpoints/control;
 * related curves, including those in the same contour, remain free to solve. */
export function setConicCurvature(source: SketchDrawing, ref: SketchEntityRef, rho: number): SketchDrawing {
  if (ref.projectedContourId !== undefined) throw Error('Projected conics are read-only.');
  if (!Number.isFinite(rho) || rho <= 0 || rho >= 1) throw Error('Conic rho must be greater than 0 and less than 1.');
  const next = structuredClone(source), segment = referencedConic(next, ref);
  const dimensions = (next.constraints ?? []).filter(c => c.kind === 'conic-rho' && !c.reference &&
    c.a.projectedContourId === undefined && c.a.contour === ref.contour && referencedConic(next, c.a) === segment);
  for (const c of dimensions) {
    const { driver, sign, offset } = resolveDimensionLink(next, c);
    if (driver.valueExpression && !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(driver.valueExpression.trim()))
      throw Error('Conic curvature is controlled by a formula. Edit its dimension or variable.');
    delete driver.valueExpression;
    driver.value = (rho - offset) / sign;
  }
  segment.rho = rho;
  const target = fixedEntityConstraint(next, { ...ref, parameter: .5 });
  while (next.constraints?.some(c => c.id === target.id)) target.id += '-';
  next.constraints = [...(next.constraints ?? []), target];
  try {
    const solved = solveDrawingConstraints(next);
    if (fixedGeometryResiduals(solved, target).some(value => Math.abs(value) >= 1e-7)) throw Error('The conic did not retain its curvature target.');
    solved.constraints = source.constraints === undefined ? undefined : solved.constraints?.filter(c => c.id !== target.id);
    validateSketchDrawing(solved);
    return solved;
  } catch (error) {
    throw Error(`Existing constraints prevent this conic edit. ${(error as Error).message}`);
  }
}

/** Project pointer displacement onto the rho axis while retaining grab offset.
 * Pointer gestures stop just inside the valid domain; typed dimensions retain
 * their full precision and reject invalid values. */
export function conicDragTarget(source: SketchDrawing, ref: SketchEntityRef, start: SketchPoint, pointer: SketchPoint, snapTolerance = 0) {
  if (![...start, ...pointer, snapTolerance].every(Number.isFinite) || snapTolerance < 0) throw Error('Conic pointer coordinates must be finite.');
  if (ref.projectedContourId !== undefined) throw Error('Projected conics are read-only.');
  const resolved = resolveSegmentReference(source.contours[ref.contour], ref);
  const handle = conicHandles(source).find(h => h.ref.contour === resolved.contour && h.ref.index === resolved.index);
  if (!handle) throw Error('Select an authored conic curvature handle.');
  const path = source.contours[ref.contour];
  if (path.type !== 'path') throw Error('Select a conic curve.');
  const segment = referencedConic(source, resolved), curveStart = resolved.index ? path.segments[resolved.index - 1].end : path.start;
  const point: SketchPoint = [handle.point[0] + pointer[0] - start[0], handle.point[1] + pointer[1] - start[1]];
  let rho = Math.max(1e-6, Math.min(1 - 1e-6, conicRhoAtPoint(curveStart, segment, point)));
  const snapped = snapTolerance > 0 && Math.abs(rho - .5) * Math.hypot(handle.control[0] - handle.midpoint[0], handle.control[1] - handle.midpoint[1]) <= snapTolerance;
  if (snapped) rho = .5;
  return { rho, snapped, handle, point: conicPoint(curveStart, { ...segment, rho }, .5) };
}
