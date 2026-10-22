import { insertFeature } from "./feature-history";
import type { PartDocument, PartFeature } from "./part-document";
import { rollbackPosition } from "./feature-history";

/** Timeline copy and paste (SolidCraft's timeline.copy / timeline.paste): the chosen
 *  features cloned under new identities and inserted at the marker, in timeline order.
 *  References between the copied features follow the copies (a copied extrude keeps
 *  pointing at the copied sketch); references to features outside the set stay. */
export function copyFeatures(doc: PartDocument, ids: readonly string[], newId: () => string = () => (globalThis.crypto?.randomUUID?.() ?? `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)): { document: PartDocument; pasted: string[] } {
  const chosen = doc.features.filter((f) => ids.includes(f.id));
  if (!chosen.length) throw new Error("Choose the features to copy.");
  const rename = new Map(chosen.map((f) => [f.id, newId()]));
  const bodyRename = new Map([...rename].map(([from, to]) => [`${doc.documentId}:body-${from}`, `${doc.documentId}:body-${to}`]));
  // Every string in the clone that names a copied feature, or a body it made, is rewritten.
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") return rename.get(value) ?? bodyRename.get(value) ?? value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, rewrite(v)]));
    return value;
  };
  let next = doc;
  const pasted: string[] = [];
  for (const feature of chosen) {
    const copy = rewrite({ ...feature, bodyId: undefined, bodyOutputs: undefined, copyBodyIds: undefined }) as PartFeature & { bodyId?: string };
    delete copy.bodyId; delete (copy as { bodyOutputs?: unknown }).bodyOutputs; delete (copy as { copyBodyIds?: unknown }).copyBodyIds;
    copy.name = `${feature.name} copy`;
    next = insertFeature(next, copy);
    pasted.push(copy.id);
  }
  return { document: next, pasted };
}
/** Where a paste lands: right after the marker, or at the end. */
export const pastePosition = (doc: PartDocument) => rollbackPosition(doc);
