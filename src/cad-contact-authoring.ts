/** Contact sets (SolidCraft's contact.*): occurrences that must not pass through each
 *  other while joints are driven. Authored here, stored by the Assembly workspace,
 *  checked by the engine against solved placements. */
export interface AssemblyContactSetDraft { readonly name: string; readonly instanceIDs: readonly string[] }
export const defaultAssemblyContactSetDraft: AssemblyContactSetDraft = Object.freeze({ name: "", instanceIDs: [] });
export function assemblyContactSetDraftIssues(draft: AssemblyContactSetDraft): readonly string[] {
  const issues: string[] = [];
  if (new Set(draft.instanceIDs).size < 2) issues.push("Choose two or more occurrences.");
  if (draft.name.length > 120) issues.push("The name is too long.");
  return issues;
}
export function assemblyContactSetPayload(draft: AssemblyContactSetDraft) {
  return { ...(draft.name.trim() ? { name: draft.name.trim() } : {}), instance_ids: [...new Set(draft.instanceIDs)] };
}
