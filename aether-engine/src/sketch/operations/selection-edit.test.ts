import { expect, it } from 'vitest';
import { editSketchSelection } from './selection-edit';
import { sketchConstraintState } from '../solver/diagnostics';
import type { SketchDrawing } from '../drawing';
const triangle = (): SketchDrawing => ({ type: 'drawing', contours: [{ type: 'path', id: 'triangle', start: [0, 0], segments: [
  { type: 'line', id: 'a', end: [20, 0] }, { type: 'line', id: 'b', end: [20, 20] }, { type: 'line', id: 'c', end: [0, 0] },
] }], constraints: [{ id: 'horizontal', kind: 'horizontal', a: { contour: 0, kind: 'line', index: 0 } }, { id: 'vertical', kind: 'vertical', a: { contour: 0, kind: 'line', index: 1 } }] });
it('deletes one exact edge and remaps the surviving constraints without changing the source', () => {
  const before = triangle(), next = editSketchSelection(before, [{ contour: 0, kind: 'line', index: 0 }]);
  expect(before.contours[0].type === 'path' && before.contours[0].segments).toHaveLength(3);
  expect(next.contours[0]).toMatchObject({ start: [20, 0], segments: [{ id: 'b' }, { id: 'c' }] });
  expect(next.constraints).toMatchObject([{ id: 'vertical', a: { contour: 0, index: 0 } }]);
});
it('deletes multiple profiles atomically and remaps references to the retained circle', () => {
  const before = triangle(); before.contours.push({ type: 'circle', center: [50, 0], radius: 5 }, { type: 'circle', center: [80, 0], radius: 7 });
  before.constraints!.push({ id: 'radius', kind: 'radius', a: { contour: 2, kind: 'circle' }, value: 7 });
  const next = editSketchSelection(before, [{ contour: 0, kind: 'contour' }, { contour: 1, kind: 'circle' }]);
  expect(next.contours).toHaveLength(1); expect(next.constraints).toMatchObject([{ id: 'radius', a: { contour: 0 } }]);
  expect(editSketchSelection(next, [{ contour: 0, kind: 'circle' }]).contours).toEqual([]);
});
it('converts just one edge to construction while preserving its endpoint relationships and exact identities', () => {
  const next = editSketchSelection(triangle(), [{ contour: 0, kind: 'line', index: 1 }], true);
  expect(next.contours).toHaveLength(2);
  const construction = next.contours.find(c => c.construction);
  expect(construction).toMatchObject({ start: [20, 0], segments: [{ id: 'b', end: [20, 20] }] });
  expect(new Set(next.contours.map(c => c.id)).size).toBe(2);
  expect(next.constraints!.filter(c => c.kind === 'coincident')).toHaveLength(2);
  expect(sketchConstraintState(next).conflictingConstraints).toEqual([]);
  expect(sketchConstraintState(next).redundantEquations).toBe(0);
});
it('refuses editing a read-only projected reference', () => {
  expect(() => editSketchSelection(triangle(), [{ contour: 0, kind: 'line', index: 0, projectedContourId: 'external' }])).toThrow('read-only');
});
