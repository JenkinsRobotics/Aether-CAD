import type { SketchDrawing } from '../../aether-engine/src/sketch/drawing';
import { regenerateDimensionExpressions } from '../../aether-engine/src/sketch/operations/dimension-expression';
import { resolveDimensionExpression, type DimensionExpressionVariables } from '../../aether-engine/src/sketch/solver/dimension-expressions';
import { regenerateSketchTextExpressions } from '../../aether-engine/src/sketch/text/regenerate-expressions';

/** An unavailable reference prevents a complete solve, not authoring or saving.
 * Update expressions and local geometry without supplying invented external
 * contacts. Keep every external equation for the eventual explicit repair.
 * Ordinary constraints and text regeneration retain their normal validation. */
export async function regenerateUnavailableSketch(source: SketchDrawing, variables: DimensionExpressionVariables): Promise<SketchDrawing> {
  const next = structuredClone(source);
  delete next.pierceContext;
  delete next.projectionContext;
  const external = new Map((next.constraints ?? []).filter(c =>
    c.kind === 'pierce' || [c.a, c.b, c.axis].some(r => r?.projectedContourId !== undefined),
  ).map(c => [c.id, c]));
  for (const c of external.values()) {
    if (c.valueExpression !== undefined) c.value = resolveDimensionExpression(c, c.valueExpression, variables);
  }
  next.constraints = next.constraints?.filter(c => !external.has(c.id));
  const updated = regenerateDimensionExpressions(await regenerateSketchTextExpressions(next, variables), variables);
  const local = new Map(updated.constraints?.map(c => [c.id, c]));
  if (source.constraints !== undefined) {
    updated.constraints = source.constraints.flatMap(c => {
      const retained = external.get(c.id) ?? local.get(c.id);
      return retained ? [retained] : [];
    });
  }
  return updated;
}
