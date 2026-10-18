import {
  inferCenterSnaps,
  inferProjectedSnaps,
  inferEllipseQuadrants,
  inferPointSnaps,
  inferLineAlignment,
  inferMidpointSnaps,
  sketchConstraintState,
  type SketchDrawing,
  type SketchPoint,
} from "@aether/core/sketch";

/** One inference pass before the workspace's geometry/undo commit. Keep gesture
 * policy here; geometric relationships and solving belong in Core. */
export function inferDrawingPlacement(
  before: SketchDrawing,
  after: SketchDrawing,
  options: {
    pointer: boolean;
    tool: string;
    placedPoints: readonly SketchPoint[];
  },
) {
  let next = inferCenterSnaps(before, inferEllipseQuadrants(before, after));
  if (options.pointer) {
    next = inferPointSnaps(before, next, options.placedPoints);
    next = inferMidpointSnaps(before, next, options.placedPoints);
    next = inferProjectedSnaps(before, next, options.placedPoints);
    if (options.tool === "line" || options.tool === "midpoint-line")
      next = inferLineAlignment(before, next);
  }
  // Center attachment + an origin fix can express the same relationship twice
  // (for example a new line starting at an already fixed circle center).
  // Automatic suggestions must not turn a valid placement into an error.
  const result = sketchConstraintState(next);
  if (result.state !== 'over-constrained') return next;
  const authored = new Set(after.constraints?.map(c => c.id));
  const accepted = { ...next, constraints: next.constraints?.filter(c => authored.has(c.id)) ?? [] };
  let state = sketchConstraintState(accepted);
  for (const candidate of next.constraints ?? []) {
    if (authored.has(candidate.id)) continue;
    accepted.constraints.push(candidate);
    const proposed = sketchConstraintState(accepted);
    if (proposed.state === 'invalid' || proposed.redundantEquations > state.redundantEquations || proposed.conflictingConstraints.length > state.conflictingConstraints.length) accepted.constraints.pop();
    else state = proposed;
  }
  return accepted;
}
