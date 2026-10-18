import {
  resolve, solveDrawingConstraints, validateSketchDrawing,
  type DrawingConstraint, type DrawingConstraintKind, type SketchDrawing, type SketchEntityRef,
} from '@aether/core/sketch';
import { sketchConstraintCatalog } from './constraint-catalog';
import { fixedEntityConstraint, fixedConstraintMatches } from '../../freecad-engine/browser/fixed-geometry';

export const supportsSelectedConstraint = (kind: string) => kind!=='pierce'&&sketchConstraintCatalog.some(c => c.kind === kind);

/** Command readiness only. The canonical resolver/solver still validates every target. */
export function selectedConstraintReady(kind: string, refs: readonly SketchEntityRef[]) {
  if (!supportsSelectedConstraint(kind)) return false;
  if (kind === 'fix') return refs.length > 0;
  if (kind === 'horizontal' || kind === 'vertical') return refs.length >= 2 || refs[0]?.kind === 'line';
  return refs.length >= (kind === 'symmetric' ? 3 : 2);
}

const refKey = (ref?: SketchEntityRef) => ref && JSON.stringify({
  contour: ref.projectedContourId === undefined ? ref.contour : undefined,
  projectedContourId: ref.projectedContourId, kind: ref.kind,
  segmentId: ref.segmentId, vertexId: ref.vertexId,
  index: ref.segmentId || ref.vertexId ? undefined : ref.index,
  control: ref.control, controlScale: ref.controlScale, parameter: ref.parameter, sliding: ref.sliding,
});

/** Compose ordinary saved constraints for a UI selection, then solve once.
 * No selection groups, alternate geometry or independent solver state are persisted. */
export function constrainSketchSelection(
  source: SketchDrawing, kind: DrawingConstraintKind, selection: readonly SketchEntityRef[],
  options: { tangentMode?: 'external' | 'internal'; sliding?: boolean; splineReversed?: boolean } = {},
) {
  const refs = [...new Map(selection.map(ref => [refKey(ref), structuredClone(ref)])).values()];
  if (!supportsSelectedConstraint(kind)) throw Error('Choose a geometric relationship for the selected entities.');
  if (!selectedConstraintReady(kind, refs)) throw Error(`Select ${kind === 'symmetric' ? 'two entities and a symmetry line' : 'enough distinct entities'} for ${kind}.`);
  for (const ref of refs) {
    resolve(source, ref);
    if (options.sliding && ref.kind === 'curve') ref.sliding = true;
  }
  const candidates: DrawingConstraint[] = [];
  const add = (a: SketchEntityRef, b?: SketchEntityRef, extra: Partial<DrawingConstraint> = {}) => {
    candidates.push({ id: crypto.randomUUID(), kind, a, ...(b ? { b } : {}), ...extra });
  };
  const pair = () => {
    if (refs.length !== 2) throw Error(`${kind} needs exactly two entities. All ${refs.length} selected entities were kept unchanged.`);
    return refs as [SketchEntityRef, SketchEntityRef];
  };
  if (kind === 'horizontal' || kind === 'vertical') {
    const points: SketchEntityRef[] = [];
    for (const ref of refs) {
      if (ref.kind === 'line') add(ref);
      else if (ref.kind === 'point') points.push(ref);
      else throw Error(`${kind} accepts lines or points. Select centers to align circles.`);
    }
    if (points.length === 1) throw Error('Select at least two points to align them, or select lines only.');
    points.slice(1).forEach(ref => add(points[0], ref));
  } else if (kind === 'coincident' && refs.length > 2) {
    const anchor = refs.find(ref => ref.kind === 'point');
    if (!anchor) throw Error('Coincident needs a shared point when selecting more than two entities.');
    refs.filter(ref => ref !== anchor).forEach(ref => add(anchor, ref));
  } else if (kind === 'parallel' || kind === 'equal' || kind === 'concentric') {
    const resolved = refs.map(ref => resolve(source, ref));
    const lines = resolved.every(e => e.line);
    if (kind === 'parallel' && !lines) throw Error('Parallel needs two or more lines.');
    if (kind === 'equal' && !lines && !resolved.every(e => e.circle)) throw Error('Equal needs lines together, or circles and circular arcs together.');
    if (kind === 'concentric' && !resolved.every(e => e.point || e.circle || e.ellipse)) throw Error('Concentric needs centers, circles, arcs or ellipses.');
    refs.slice(1).forEach(ref => add(refs[0], ref));
  } else if (kind === 'fix') {
    // Whole contours/curves cover their own nodes. Apply them first so mixed
    // picks create one lock instead of redundant point equations.
    const ordered = [...refs].sort((a,b) => (a.kind === 'point' ? 2 : a.kind === 'contour' ? 0 : 1) - (b.kind === 'point' ? 2 : b.kind === 'contour' ? 0 : 1));
    for (const ref of ordered) {
      if (![...(source.constraints ?? []), ...candidates].some(c => fixedConstraintMatches(source, c, ref) && (ref.kind !== 'contour' || c.a.kind === 'contour'))) candidates.push(fixedEntityConstraint(source, ref));
    }
  } else if (kind === 'symmetric') {
    if (refs.length !== 3 || refs[2].kind !== 'line') throw Error('Select two entities, then their symmetry line.');
    add(refs[0], refs[1], { axis: refs[2], ...(refs[0].kind === 'contour' && refs[1].kind === 'contour' ? { splineReversed: !!options.splineReversed } : {}) });
  } else {
    let [a, b] = pair();
    if (kind === 'midpoint' && a.kind === 'point') [a, b] = [b, a];
    add(a, b, kind === 'tangent' ? { tangentMode: options.tangentMode ?? 'external' } : {});
  }
  // Repeating a command must not add the same equation again. Directional
  // midpoint/normal/curvature contacts retain their original ordering.
  const reversible = ['coincident', 'horizontal', 'vertical', 'equal', 'parallel', 'perpendicular', 'concentric', 'tangent'].includes(kind);
  const same = (a: DrawingConstraint, b: DrawingConstraint) =>
    a.kind === b.kind && refKey(a.axis) === refKey(b.axis) &&
    (a.tangentMode ?? 'external') === (b.tangentMode ?? 'external') &&
    !!a.splineReversed === !!b.splineReversed &&
    ((refKey(a.a) === refKey(b.a) && refKey(a.b) === refKey(b.b)) ||
      (reversible && refKey(a.a) === refKey(b.b) && refKey(a.b) === refKey(b.a)));
  const next = structuredClone(source);
  const constraints = next.constraints ??= [];
  const alreadyLinked = (candidate: DrawingConstraint) => {
    if (!candidate.b || !['equal', 'parallel', 'concentric', 'horizontal', 'vertical', 'coincident'].includes(kind)) return false;
    const pointOnly = ['horizontal', 'vertical', 'coincident'].includes(kind);
    if (pointOnly && (candidate.a.kind !== 'point' || candidate.b.kind !== 'point')) return false;
    const seen = new Set([refKey(candidate.a)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of constraints) {
        if (c.kind !== kind || !c.b) continue;
        if (pointOnly && (c.a.kind !== 'point' || c.b.kind !== 'point')) continue;
        const a = refKey(c.a), b = refKey(c.b);
        if (seen.has(a) && !seen.has(b)) { seen.add(b); changed = true; }
        if (seen.has(b) && !seen.has(a)) { seen.add(a); changed = true; }
      }
    }
    return seen.has(refKey(candidate.b));
  };
  let added = 0;
  for (const candidate of candidates) {
    if (constraints.some(c => same(c, candidate)) || alreadyLinked(candidate)) continue;
    constraints.push(candidate); added += 1;
  }
  if (!added) return { drawing: source, added: 0 };
  const solved = solveDrawingConstraints(next);
  validateSketchDrawing(solved);
  return { drawing: solved, added };
}
