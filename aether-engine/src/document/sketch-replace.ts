import { validateSketchDrawing, type SketchDrawing } from "../sketch/drawing";
import { validatePartDocument, type PartDocument, type ProfileFeature } from "./part-document";

/** Replace an existing profile sketch's drawing contents while preserving its feature ID,
 *  name, plane/support, flip, offset, and timeline position (`sketch.replace`). */
export function replaceSketchDrawing(
  document: PartDocument,
  featureId: string,
  newDrawing: SketchDrawing,
): PartDocument {
  validatePartDocument(document);
  validateSketchDrawing(newDrawing);
  const next = structuredClone(document);
  const index = next.features.findIndex((f) => f.id === featureId);
  if (index < 0) throw new Error(`Sketch feature ${featureId} does not exist.`);
  const target = next.features[index];
  if (target.type !== "profile") throw new Error(`Feature ${featureId} is not a profile sketch.`);
  const updated: ProfileFeature = {
    ...target,
    profile: structuredClone(newDrawing),
  };
  next.features[index] = updated;
  validatePartDocument(next);
  return next;
}
