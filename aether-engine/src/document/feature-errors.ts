import type { PartDocument } from './part-document';
import { featureDependencies, rollbackPosition } from './feature-history';
import { pierceReferenceFailure } from '../../../freecad-engine/browser/pierce-availability';
import { resolveProfileDrawing } from './profile-projection';
import type { SketchDrawing } from '../sketch/drawing';

/** Evaluated availability, never a persisted Suppress flag. */
export function featureReferenceErrors(document: PartDocument, failures: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const errors = new Map<string, string>();
  const earlier = new Map<string, boolean>();
  const names = new Map(document.features.map(f => [f.id, f.name]));
  const dependencies = featureDependencies(document);
  const drawings = new Map<string, SketchDrawing>();
  const resolveDrawing = (id: string) => {
    let drawing = drawings.get(id);
    if (!drawing) { drawing = resolveProfileDrawing(document.features, id); drawings.set(id, drawing); }
    return drawing;
  };
  for (const feature of document.features.slice(0, rollbackPosition(document))) {
    if (!feature.suppressed) {
      const dependency = dependencies.get(feature.id)?.find(id => !earlier.get(id));
      const reason = failures.get(feature.id) ?? (dependency ?
        names.has(dependency) ? `Reference unavailable: ${names.get(dependency)}. Restore or repair that feature.`
          : `Missing reference: ${dependency}. Restore the deleted feature or select a new reference.` : undefined)
        ?? pierceReferenceFailure(document.features, feature, resolveDrawing);
      if (reason) errors.set(feature.id, reason);
    }
    earlier.set(feature.id, !feature.suppressed && !errors.has(feature.id));
  }
  return errors;
}
