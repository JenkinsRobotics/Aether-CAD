import { bodyIDForFeature, createdBodyIDs, rollbackPosition, validatePartDocument, type PartDocument } from "@aether/core/document";

/** Resolve native body identities without mutating the preview or saved input. */
export function resolveBodyOutputs(document: PartDocument, outputs: Record<string, string[]> = {}): PartDocument {
  const cutoff = rollbackPosition(document);
  const expected = new Set(document.features.slice(0, cutoff)
    .filter(f => !f.suppressed && ((f.type === "extrude" && f.operation === "new" && f.separateBodies) || (f.type === "transform" && f.copyBodyIds))).map(f => f.id));
  if (Object.keys(outputs).some(id => !expected.has(id))) throw new Error("Rebuild returned an unknown body producer.");
  const next = { ...document, features: document.features.map(feature => {
    if (!expected.has(feature.id)) return feature;
    const ids = outputs[feature.id];
    if(feature.type==='transform'){
      const expected=createdBodyIDs(document,feature);
      if(!Array.isArray(ids)||ids.length!==expected.length||new Set(ids).size!==ids.length||ids.some(id=>!expected.includes(id)))throw Error(`${feature.name}: rebuild changed the saved copy identities.`);
      return feature;
    }
    const prefix = `${bodyIDForFeature(document, feature)}:solid-`;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !id.startsWith(prefix)) || new Set(ids).size !== ids.length)
      throw new Error(`${feature.name}: rebuild did not return distinct output body identities.`);
    return { ...feature, bodyOutputs: [...ids] };
  }) };
  validatePartDocument(next);
  return next;
}
