/** Contact set: the occurrences that must not pass through each other. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { type AssemblyContactSetDraft, assemblyContactSetDraftIssues, defaultAssemblyContactSetDraft } from "../../cad-contact-authoring";
import { Button, Checkbox, Dialog, FieldRow, TextField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export function AssemblyContactSetDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const instances = assembly.data?.instanceOptions ?? [];
  const [draft, setDraft] = useState<AssemblyContactSetDraft>(defaultAssemblyContactSetDraft);
  const open = presentation.startDialog === "create-contact-set";
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  useEffect(() => { if (open) setDraft(defaultAssemblyContactSetDraft); }, [open]);
  const issues = assemblyContactSetDraftIssues(draft);
  const toggle = (id: string, checked: boolean) => setDraft({ ...draft, instanceIDs: checked ? [...draft.instanceIDs, id] : draft.instanceIDs.filter((item) => item !== id) });
  return (
    <Dialog open={open} title="Create contact set" onClose={close} actions={(<>
      <Button onClick={close}>Cancel</Button>
      <Button primary disabled={issues.length > 0} onClick={() => cadPresentation.dispatch({ type: "create-assembly-contact-set", draft })}>Create Contact Set</Button>
    </>)}>
      <div className="cad-start-form">
        <FieldRow label="Name" htmlFor="assembly-contact-name">
          <TextField id="assembly-contact-name" value={draft.name} placeholder="Contact set" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </FieldRow>
        <fieldset className="cad-contact-occurrences" aria-label="Occurrences in contact">
          {instances.map((instance) => (
            <Checkbox key={instance.id} checked={draft.instanceIDs.includes(instance.id)} onChange={(event) => toggle(instance.id, event.target.checked)} label={instance.name} />
          ))}
        </fieldset>
        <p className="cad-form-note">Driven joints and motion studies stop where bodies in one set would pass through each other. Turn contacts on from the Relations tab.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
