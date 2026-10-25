/** Contact set: the occurrences that must not pass through each other. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { type AssemblyContactSetDraft, assemblyContactSetDraftIssues, defaultAssemblyContactSetDraft } from "../../cad-contact-authoring";
import { Button, Checkbox, Dialog, FieldRow, TextField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ContactSetProjection } from "../../cad-assembly-bridge";

export function AssemblyContactSetDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const contacts = assembly.data?.contacts;
  const instances = contacts?.instances ?? [];
  const [draft, setDraft] = useState<AssemblyContactSetDraft>(defaultAssemblyContactSetDraft);
  const [source, setSource] = useState<ContactSetProjection | null>(null);
  const editing = presentation.startDialog === "edit-contact-set";
  const open = presentation.startDialog === "create-contact-set" || editing;
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  useEffect(() => {
    if (!open) return;
    const selected = editing ? contacts?.selected ?? null : null;
    setSource(selected);
    setDraft(selected ? { name: selected.name, instanceIDs: selected.instance_ids, suppressed: selected.suppressed } : defaultAssemblyContactSetDraft);
  }, [open, editing]);
  const issues = [...assemblyContactSetDraftIssues(draft)];
  if (!contacts?.editable) issues.push("Contact editing is unavailable in this workspace.");
  if (editing && (!source || !contacts?.sets.includes(source))) issues.push("The contact set changed. Close and reopen this editor.");
  if (draft.instanceIDs.some(id => !instances.some(instance => instance.id === id))) issues.push("A selected occurrence is no longer available.");
  const toggle = (id: string, checked: boolean) => setDraft({ ...draft, instanceIDs: checked ? [...draft.instanceIDs, id] : draft.instanceIDs.filter((item) => item !== id) });
  return (
    <Dialog open={open} title={editing ? "Edit contact set" : "Create contact set"} onClose={close} actions={(<>
      <Button onClick={close}>Cancel</Button>
      <Button primary disabled={issues.length > 0} onClick={() => {
        if (editing && source) cadPresentation.dispatch({ type: "update-assembly-contact-set", source, draft });
        else if (!editing) cadPresentation.dispatch({ type: "create-assembly-contact-set", draft });
      }}>{editing ? "Save Contact Set" : "Create Contact Set"}</Button>
    </>)}>
      <div className="cad-start-form">
        <FieldRow label="Name" htmlFor="assembly-contact-name">
          <TextField id="assembly-contact-name" value={draft.name} placeholder="Contact set" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </FieldRow>
        <fieldset className="cad-contact-occurrences" aria-label="Occurrences in contact">
          {instances.map((instance) => (
            <Checkbox key={instance.id} checked={draft.instanceIDs.includes(instance.id)} onChange={(event) => toggle(instance.id, event.target.checked)} label={instance.suppressed ? `${instance.name} (suppressed)` : instance.name} />
          ))}
        </fieldset>
        <Checkbox label="Suppress contact set" checked={draft.suppressed ?? false} onChange={event => setDraft({ ...draft, suppressed: event.target.checked })} />
        <p className="cad-form-note">When contact checks are enabled, overlapping final positions are refused. Suppressed components and sets are excluded.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
