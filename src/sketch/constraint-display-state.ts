import type { SketchConstraintState } from '@aether/core/sketch';

/** Redundancy is a warning about repeated equations, not unsatisfied geometry.
 * Preserve its count for diagnostics while coloring actual mobility normally. */
export function constraintDisplayState(state: SketchConstraintState): SketchConstraintState {
  if (state.state !== 'over-constrained' || state.conflictingConstraints.length || !state.redundantEquations) return state;
  return { ...state, state: state.degreesOfFreedom ? 'under-constrained' : 'fully-constrained' };
}
