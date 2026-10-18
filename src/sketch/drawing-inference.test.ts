import { expect, it } from 'vitest';
import { sketchConstraintState, type SketchDrawing } from '@aether/core/sketch';
import { inferDrawingPlacement } from './drawing-inference';
import { constraintDisplayState } from './constraint-display-state';
it('adds a vertical line at a fixed circle center without redundant origin anchoring', () => {
  const before: SketchDrawing = { type: 'drawing', contours: [{ type: 'circle', center: [0, 0], radius: 10 }], constraints: [{ id: 'center-fixed', kind: 'fix', a: { contour: 0, kind: 'point', index: 0 }, point: [0, 0] }] };
  const after = structuredClone(before); after.contours.push({ type: 'path', start: [0, 0], segments: [{ type: 'line', end: [0, 50] }] });
  const result = inferDrawingPlacement(before, after, { pointer: true, tool: 'line', placedPoints: [[0, 0], [0, 50]] });
  expect(result.constraints!.some(c => c.kind === 'vertical')).toBe(true);
  expect(result.constraints!.some(c => c.kind === 'concentric')).toBe(true);
  expect(result.constraints!.filter(c => c.kind === 'fix')).toHaveLength(1);
  expect(sketchConstraintState(result)).toMatchObject({ state: 'under-constrained', redundantEquations: 0, conflictingConstraints: [] });
});
it('shows consistent redundancy as a warning but retains actual unsatisfied constraints as errors', () => {
  const state = { state: 'over-constrained' as const, degreesOfFreedom: 3, redundantEquations: 2, conflictingConstraints: [] };
  expect(constraintDisplayState(state)).toMatchObject({ state: 'under-constrained', redundantEquations: 2 });
  expect(constraintDisplayState({ ...state, conflictingConstraints: ['conflict'] }).state).toBe('over-constrained');
});
