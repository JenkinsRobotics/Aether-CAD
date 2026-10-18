import { sketchPointRole } from "./point-roles";
import { nearestPoint, nearestAxis } from '@aether/sketch';
import { centerSnapPoints, midpointSnapPoints, sketchEntities, sketchEntityPoint, solveDrawingConstraints,
  type DrawingConstraint, type SketchDrawing, type SketchEntityRef, type SketchPoint } from '@aether/core/sketch';

type Target = { point: SketchPoint; label: string; ref?: SketchEntityRef; relation?: 'coincident' | 'concentric' | 'midpoint' };
export type DragGuide = { from: SketchPoint; to: SketchPoint; label: string };
export type DragSnap = { point: SketchPoint; guides: DragGuide[]; constraints: Omit<DrawingConstraint, 'id'>[] };
const distance = (a: SketchPoint, b: SketchPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Use a real point on the dragged entity, preserving the pointer's grab offset. */
export function dragAnchor(drawing: SketchDrawing, ref: SketchEntityRef, pointer: SketchPoint): SketchEntityRef | undefined {
  if (ref.kind === 'point') return ref;
  if (drawing.contours[ref.contour]?.type === 'circle') return { contour: ref.contour, kind: 'point', index: 0 };
  const candidates = [ref.index ?? 0, (ref.index ?? 0) + 1].map(index => ({ contour: ref.contour, kind: 'point' as const, index }));
  return candidates.filter(r => sketchEntityPoint(drawing, r)).sort((a, b) => distance(sketchEntityPoint(drawing, a)!, pointer) - distance(sketchEntityPoint(drawing, b)!, pointer))[0];
}

/** Inference is transient. Exclude geometry that follows the drag through existing
 * constraints, so concentric rings and connected geometry cannot snap to themselves. */
export function snapDraggedPoint(before: SketchDrawing, preview: SketchDrawing, anchor: SketchEntityRef, tolerance: number): DragSnap {
  const raw = sketchEntityPoint(preview, anchor)!;
  const targets: Target[] = [{ point: [0, 0], label: 'Origin' }];
  for (const { ref } of sketchEntities(before)) {
    if (ref.kind !== 'point' || ref.control !== undefined || (ref.contour === anchor.contour && ref.index === anchor.index)) continue;
    const p = sketchEntityPoint(before, ref), q = sketchEntityPoint(preview, ref);
    if (p && q && distance(p, q) < 1e-7) targets.push({ point: p, ref, relation: 'coincident', label: sketchPointRole(before, ref) ?? 'Endpoint' });
  }
  for (const [getPoints, label, relation] of [
    [midpointSnapPoints, 'Midpoint', 'midpoint'], [centerSnapPoints, 'Center', 'concentric'],
  ] as const) {
    const next = getPoints(preview);
    for (const candidate of getPoints(before)) {
      const current = next.find(c => JSON.stringify(c.ref) === JSON.stringify(candidate.ref));
      if (current && distance(candidate.point, current.point) < 1e-7)
        targets.push({ ...candidate, label, relation });
    }
  }
  const nearest = nearestPoint(raw, targets, tolerance);
  if (nearest) {
    const constraint: Omit<DrawingConstraint, 'id'> = !nearest.ref ? { kind: 'fix', a: anchor, point: [0, 0] }
      : nearest.relation === 'midpoint' ? { kind: 'midpoint', a: nearest.ref, b: anchor }
      : { kind: nearest.relation!, a: anchor, b: nearest.ref };
    return { point: [...nearest.point], guides: [{ from: nearest.point, to: nearest.point, label: nearest.label }], constraints: [constraint] };
  }
  const point: SketchPoint = [...raw], guides: DragGuide[] = [], constraints: Omit<DrawingConstraint, 'id'>[] = [];
  for (const axis of [0, 1] as const) {
    // Pairwise H/V constraints require point entities; center/midpoint positions
    // also provide temporary visual alignment without inventing saved geometry.
    const target = nearestAxis(raw, targets, tolerance, axis);
    if (!target) continue;
    point[axis] = target.point[axis];
    const label = axis === 0 ? 'Vertical' : 'Horizontal';
    guides.push({ from: target.point, to: point, label });
    if (target.ref?.kind === 'point') constraints.push({ kind: axis === 0 ? 'vertical' : 'horizontal', a: anchor, b: target.ref });
  }
  return { point, guides, constraints };
}

/** Called only on release. Geometry and inferred relationships form one undo step. */
export function commitDragSnap(drawing: SketchDrawing, snap?: DragSnap): SketchDrawing {
  if (!snap?.constraints.length) return drawing;
  const constraints = [...(drawing.constraints ?? [])];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const relation of snap.constraints) {
    if (constraints.some(c => c.kind === relation.kind && same(c.point, relation.point) &&
      ((same(c.a, relation.a) && same(c.b, relation.b)) || (same(c.a, relation.b) && same(c.b, relation.a))))) continue;
    let id = 'drag-inferred';
    while (constraints.some(c => c.id === id)) id += '-';
    constraints.push({ ...relation, id });
  }
  return solveDrawingConstraints({ ...drawing, constraints });
}
