/** Component edits beyond insertion (SolidCraft's component.metadata.set,
 *  from_bodies, move_bodies, move_sketches, paste_new): the drafts the dialogs
 *  hold and the checks the controller trusts. */
export interface PartPropertiesDraft { readonly partNumber: string; readonly description: string; /** one `key = value` per line */ readonly properties: string }
export function partPropertiesDraftFrom(definition: { part_number: string | null; description: string | null; custom_properties: readonly { key: string; value: string }[] }): PartPropertiesDraft {
  return { partNumber: definition.part_number ?? "", description: definition.description ?? "", properties: definition.custom_properties.map((p) => `${p.key} = ${p.value}`).join("\n") };
}
export function parseCustomProperties(text: string): { key: string; value: string }[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const at = line.indexOf("=");
    if (at <= 0) throw new Error(`"${line}" is not key = value.`);
    const key = line.slice(0, at).trim(), value = line.slice(at + 1).trim();
    if (!key) throw new Error(`"${line}" has no key.`);
    return { key, value };
  });
}
export function partPropertiesDraftIssues(draft: PartPropertiesDraft): readonly string[] {
  const issues: string[] = [];
  if (draft.partNumber.length > 120) issues.push("The part number is too long.");
  try { const keys = parseCustomProperties(draft.properties).map((p) => p.key); if (new Set(keys).size !== keys.length) issues.push("A property key repeats."); }
  catch (error) { issues.push((error as Error).message); }
  return issues;
}

export interface BodiesToComponentDraft {
  readonly sourceInstanceID: string;
  readonly bodyIDs: readonly string[];
  readonly sketchIDs: readonly string[];
  /** "new" makes one component per picked body (from_bodies); an instance id moves into it (move_bodies / move_sketches). */
  readonly target: string;
  readonly name: string;
}
export const defaultBodiesToComponentDraft = (sourceInstanceID = ""): BodiesToComponentDraft => ({ sourceInstanceID, bodyIDs: [], sketchIDs: [], target: "new", name: "" });
export function bodiesToComponentDraftIssues(draft: BodiesToComponentDraft): readonly string[] {
  const issues: string[] = [];
  if (!draft.sourceInstanceID) issues.push("Choose the occurrence the bodies come from.");
  if (!draft.bodyIDs.length && !draft.sketchIDs.length) issues.push("Choose at least one body or sketch.");
  if (draft.target !== "new" && draft.target === draft.sourceInstanceID) issues.push("The target is the source occurrence.");
  return issues;
}
