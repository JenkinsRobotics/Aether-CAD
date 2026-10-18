import { contourClosed, validateSketchDrawing, type SketchDrawing } from '../drawing';
import type { SketchEntityRef } from '../solver/types';
import { deleteSketchContour } from './delete';
import { remapTrimReferences, type TrimSegmentOrigin } from './trim-references';
import { identifyTrimmedPaths } from './trim-identities';

/** Edit selected exact entities using the same identity/relationship remapping
 * as trim. Removing an edge opens a gap; it never deletes its unselected peers. */
export function editSketchSelection(source: SketchDrawing, refs: readonly SketchEntityRef[], construction?: boolean): SketchDrawing {
  if (refs.some(r => r.projectedContourId !== undefined)) throw Error('Projected references are read-only. Project them into the sketch before editing.');
  let next = structuredClone(source);
  const indices = [...new Set(refs.map(r => r.contour))].sort((a, b) => b - a);
  for (const contour of indices) {
    const original = next.contours[contour];
    if (!original) throw Error('Select existing sketch geometry.');
    const selected = refs.filter(r => r.contour === contour);
    if (original.type === 'circle' || !original.segments.length || selected.some(r => r.kind === 'contour')) {
      if (construction === undefined) next = deleteSketchContour(next, contour);
      else next.contours[contour].construction = construction;
      continue;
    }
    const count = original.segments.length, closed = contourClosed(original), chosen = new Set<number>();
    for (const ref of selected) {
      if (ref.index === undefined) throw Error('Select an edge or vertex.');
      if (ref.kind === 'point') {
        if (ref.control !== undefined) throw Error('Delete the spline edge rather than its control handle.');
        if (ref.index > 0) chosen.add(ref.index - 1);
        if (ref.index < count) chosen.add(ref.index);
        if (closed && (ref.index === 0 || ref.index === count)) { chosen.add(0); chosen.add(count - 1); }
      } else chosen.add(ref.index);
    }
    if ([...chosen].some(i => i < 0 || i >= count)) throw Error('Select an existing sketch edge.');
    if (chosen.size === count) {
      if (construction === undefined) next = deleteSketchContour(next, contour);
      else next.contours[contour].construction = construction;
      continue;
    }
    const groups: { mode: boolean | null; segments: number[] }[] = [];
    for (let i = 0; i < count; i++) {
      const mode = chosen.has(i) ? construction ?? null : Boolean(original.construction);
      if (groups.at(-1)?.mode === mode) groups.at(-1)!.segments.push(i);
      else groups.push({ mode, segments: [i] });
    }
    if (closed && groups.length > 1 && groups[0].mode === groups.at(-1)!.mode) {
      const last = groups.pop()!; groups[0].segments = [...last.segments, ...groups[0].segments];
    }
    const kept = groups.filter(g => g.mode !== null);
    const layout: TrimSegmentOrigin[][] = kept.map(g => g.segments.map(segment => ({ segment, keepStart: true, keepEnd: true, whole: true, interval: [0, 1] })));
    const replacements = kept.map((g, index) => {
      const first = g.segments[0];
      return { ...original, ...(original.id && index ? { id: crypto.randomUUID() } : {}), hole: false,
        construction: g.mode!, start: structuredClone(first ? original.segments[first - 1].end : original.start),
        segments: g.segments.map(i => structuredClone(original.segments[i])) };
    });
    identifyTrimmedPaths(original, replacements, layout);
    const before = next; next = structuredClone(before);
    next.contours.splice(contour, 1, ...replacements);
    remapTrimReferences(before, next, contour, layout, closed);
    if (construction !== undefined) {
      // A path's shared vertex becomes two vertices at a regular/construction
      // boundary. Preserve that relationship explicitly after splitting.
      const endpoints = new Map<number, SketchEntityRef[]>();
      layout.forEach((entries, offset) => {
        for (const [old, index] of [[entries[0].segment, 0], [entries.at(-1)!.segment + 1, entries.length]]) {
          const key = closed ? old % count : old;
          endpoints.set(key, [...endpoints.get(key) ?? [], { contour: contour + offset, kind: 'point', index }]);
        }
      });
      for (const points of endpoints.values()) if (points.length > 1) {
        (next.constraints ??= []).push({ id: `construction-junction-${crypto.randomUUID()}`, kind: 'coincident', a: points[0], b: points[1] });
      }
    }
  }
  validateSketchDrawing(next);
  return next;
}
