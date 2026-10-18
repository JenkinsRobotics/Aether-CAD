/** Canonical Pierce solving and isolated authoring drafts. Only the external
 * reference is retained; intersection points are derived, read-only inputs. */
import type { PartFeature } from '../../aether-engine/src/document/part-document';
import type { SketchDrawing, SketchPoint } from '../../aether-engine/src/sketch/drawing';
import { solveDrawingConstraints } from '../../aether-engine/src/sketch/solver/solve';
import { resolve } from '../../aether-engine/src/sketch/solver/entities';
import { resolveSegmentReference } from '../../aether-engine/src/sketch/solver/segment-reference';
import { closestSegmentParameter } from '../../aether-engine/src/sketch/curves/parameterization';
import type { SketchEntityRef } from '../../aether-engine/src/sketch/solver/types';
import { resolveSketchPierce, type SketchPierceReference } from './pierce-reference';
import { pierceContextPoint, validatePierceConstraint } from './pierce-context';
import type { DrawingConstraint } from '../../aether-engine/src/sketch/solver/types';

export interface PierceConstraintDraft {
  id: string;
  kind: 'pierce';
  a: SketchEntityRef;
  source: SketchPierceReference;
}

/** Convert an authored edge pick to a bounded contact, so an arc/line does not
 * accidentally attach through its infinite extension. Full circles have no end. */
export function pierceTargetReference(drawing: SketchDrawing, target: SketchEntityRef, point: SketchPoint): SketchEntityRef {
  if (!target || target.projectedContourId !== undefined || !Number.isInteger(target.contour) || target.contour < 0)
    throw Error('Pierce needs an editable point or curve in the current sketch.');
  const contour = drawing.contours[target.contour];
  const ref = resolveSegmentReference(contour, structuredClone(target));
  if (ref.kind === 'point') {
    if (ref.parameter !== undefined || ref.sliding !== undefined || !resolve(drawing, ref).point)
      throw Error('Invalid Pierce point target.');
    return ref;
  }
  if (ref.kind === 'circle' && contour?.type === 'circle') {
    if (ref.parameter !== undefined || ref.sliding !== undefined || ref.control !== undefined)
      throw Error('Invalid Pierce circle target.');
    resolve(drawing, ref);
    return ref;
  }
  if (contour?.type !== 'path' || !['line','arc','ellipse','curve'].includes(ref.kind) || ref.control !== undefined)
    throw Error('Select one Pierce target point or finite curve segment.');
  const index = ref.index, segment = contour.segments[index!];
  if (!Number.isInteger(index) || !segment || (ref.kind !== 'curve' && ref.kind !== segment.type))
    throw Error('The Pierce target segment is missing or changed type.');
  const parameter = ref.parameter ?? closestSegmentParameter(index ? contour.segments[index - 1].end : contour.start, segment, point).parameter;
  if (!Number.isFinite(parameter) || parameter < 0 || parameter > 1)
    throw Error('Pierce curve contact parameter must be between zero and one.');
  // A target contact slides along the finite curve as its geometry is edited.
  // The source intersection branch is independently pinned by its reference.
  return { ...ref, kind: 'curve', parameter, sliding: true };
}

function targetPoint(drawing: SketchDrawing, a: SketchEntityRef, point: SketchPoint): SketchPoint {
  const entity = resolve(drawing, a);
  if (entity.circle) {
    const { center, radius } = entity.circle;
    const dx = point[0] - center[0], dy = point[1] - center[1], length = Math.hypot(dx, dy);
    return length > 1e-12 ? [center[0] + radius * dx / length, center[1] + radius * dy / length] : [center[0] + radius, center[1]];
  }
  const at = entity.point ?? entity.curve?.point;
  if (!at) throw Error('Invalid Pierce contact target.');
  return at;
}
/** A second numerical seed translates affected contours toward their contacts,
 * retaining their shape and every saved driver. It does not translate fixed
 * targets or constraints. All equations must still pass the ordinary solver. */
function translatedSeed(drawing: SketchDrawing, contacts: { a: SketchEntityRef; point: SketchPoint }[]): SketchDrawing {
  const next = structuredClone(drawing), moves = new Map<number, SketchPoint[]>();
  for (const { a, point } of contacts) {
    const at = targetPoint(drawing, a, point);
    const list = moves.get(a.contour) ?? [];
    list.push([point[0] - at[0], point[1] - at[1]]);moves.set(a.contour, list);
  }
  for (const [index, deltas] of moves) {
    const dx = deltas.reduce((s, d) => s + d[0], 0) / deltas.length;
    const dy = deltas.reduce((s, d) => s + d[1], 0) / deltas.length;
    const c = next.contours[index], seen = new Set<SketchPoint>();
    const move = (p: SketchPoint) => { if (!seen.has(p)) { p[0] += dx;p[1] += dy;seen.add(p); } };
    if (c.type === 'circle') move(c.center);
    else { move(c.start);for (const s of c.segments) {
      move(s.end);
      if (s.type === 'arc') move(s.middle);
      if (s.type === 'bezier') s.controls.forEach(move);
      if (s.type === 'conic') move(s.control);
    } }
  }
  return next;
}

/** Compose Pierce with ordinary dimensions and geometric constraints in one
 * solve. Temporary source points are fixed, cannot receive solver coordinates,
 * and are removed before returning. Errors never modify inputs or references. */
export function solvePierceConstraintDrafts(
  features: readonly PartFeature[], targetFeatureId: string,
  drawing: SketchDrawing, constraints: readonly PierceConstraintDraft[],
): { drawing: SketchDrawing; constraints: PierceConstraintDraft[] } {
  return solveRelations(drawing,constraints,c=>resolveSketchPierce(features,targetFeatureId,c.source).point);
}

function solveRelations(drawing:SketchDrawing,constraints:readonly PierceConstraintDraft[],pointFor:(c:PierceConstraintDraft)=>SketchPoint,options:{fixedContours?:ReadonlySet<number>}={}) {
  const next = structuredClone(drawing), count = next.contours.length;
  const existing = next.constraints ?? [];
  const ids = new Set(existing.map(c => c.id)), fixed = new Set<number>(options.fixedContours);
  const prepared = constraints.map(c => {
    if (!c || c.kind !== 'pierce' || typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id))
      throw Error('Pierce constraints need unique nonempty identities.');
    ids.add(c.id);
    validatePierceConstraint(c);
    const point = pointFor(c);
    const a = pierceTargetReference(drawing, c.a, point);
    const contour = next.contours.length;
    next.contours.push({ type: 'path', construction: true, start: [...point], segments: [] });
    fixed.add(contour);
    return { point, draft: { ...structuredClone(c), a }, equation: {
      id: c.id, kind: 'coincident' as const, a, b: { contour, kind: 'point' as const, index: 0 },
    } };
  });
  next.constraints = [...existing, ...prepared.map(p => p.equation)];
  const solve = (input: SketchDrawing) => {
    const result = solveDrawingConstraints(input, { fixedContours: fixed });
    for (const [index, p] of prepared.entries()) {
      const at = targetPoint(result, result.constraints![existing.length + index].a, p.point);
      // The generic solver checks each equation component. Pierce additionally
      // guarantees geometric distance, matching the exact native contact guard.
      if (Math.hypot(at[0] - p.point[0], at[1] - p.point[1]) >= 1e-7)
        throw Error('The Pierce contact cannot converge accurately. No geometry was changed.');
    }
    return result;
  };
  let solved: SketchDrawing;
  try { solved = solve(next); }
  catch (error) {
    if (!(error instanceof Error) || !/conflict|converge|singular/i.test(error.message)) throw error;
    solved = solve(translatedSeed(next, prepared.map(p => ({ a: p.draft.a, point: p.point }))));
  }
  const returned: SketchDrawing = { ...solved, contours: solved.contours.slice(0, count) };
  // Preserve the original absent-vs-present contract and all ordinary driver edits.
  if (drawing.constraints === undefined) delete returned.constraints;
  else returned.constraints = solved.constraints!.slice(0, existing.length);
  return { drawing: returned, constraints: prepared.map((p, index) => ({
    ...p.draft, a: structuredClone(solved.constraints![existing.length + index].a),
  })) };
}

/** Dispatcher for the one canonical constraint list. Temporary equations never
 * escape and the original relationship ordering/identities remain intact. */
export function solveSavedPierceConstraints(source:SketchDrawing,options:{fixedContours?:ReadonlySet<number>}={}):SketchDrawing {
  const relations=source.constraints!.filter(c=>c.kind==='pierce') as PierceConstraintDraft[];
  const ordinary={...source,constraints:source.constraints!.filter(c=>c.kind!=='pierce')};
  const solved=solveRelations(ordinary,relations,c=>pierceContextPoint(source,c),options);
  const byId=new Map([...solved.drawing.constraints??[],...solved.constraints].map(c=>[c.id,c]));
  return {...solved.drawing,constraints:source.constraints!.map(c=>byId.get(c.id)!)};
}

export function pierceResiduals(drawing:SketchDrawing,c:DrawingConstraint):number[] {
  const point=pierceContextPoint(drawing,c),at=targetPoint(drawing,c.a,point);
  return [at[0]-point[0],at[1]-point[1]];
}
