import type { PartFeature } from '../../aether-engine/src/document/part-document';
import type { SketchDrawing } from '../../aether-engine/src/sketch/drawing';
import { validatePierceConstraint } from './pierce-context';
import { resolveSketchPierce } from './pierce-reference';
import { PierceReferenceError } from './pierce-reference-error';

/** Evaluated subentity availability. The caller propagates this to descendants
 * in history order; it never writes suppression or stale contact coordinates. */
export function pierceReferenceFailure(
  features: readonly PartFeature[], feature: PartFeature,
  resolveDrawing: (id: string) => SketchDrawing,
): string | undefined {
  if (feature.type !== 'profile') return;
  const drawing = feature.profile.type === 'drawing' ? feature.profile
    : feature.profile.type === 'projection' ? feature.profile.authored : undefined;
  for (const constraint of drawing?.constraints ?? []) {
    if (constraint.kind !== 'pierce') continue;
    validatePierceConstraint(constraint);
    try {
      resolveSketchPierce(features, feature.id, constraint.source!, resolveDrawing);
    } catch (error) {
      if (!(error instanceof PierceReferenceError)) throw error;
      return `Pierce reference unavailable (${constraint.id}): ${error.message}`;
    }
  }
}
