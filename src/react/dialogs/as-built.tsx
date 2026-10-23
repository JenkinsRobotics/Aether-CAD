/** As-built joint: two occurrences stay where they are; the joint frame is placed on them. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { type AsBuiltJointDraft, asBuiltJointDraftIssues, defaultAsBuiltJointDraft } from "../../cad-joint-authoring";
import { type AssemblyMateTypeID, assemblyMateTypeOptions } from "../../cad-mate-authoring";
import { Button, Dialog, FieldRow, SelectField, TextField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export function AsBuiltJointDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const instances = assembly.data?.instanceOptions ?? [];
  const selected = assembly.data?.selectedInstanceID ?? null;
  const [draft, setDraft] = useState<AsBuiltJointDraft>(defaultAsBuiltJointDraft);
  const open = presentation.startDialog === "as-built-joint";
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  useEffect(() => { if (open) setDraft({ ...defaultAsBuiltJointDraft, aInstanceID: selected ?? instances[0]?.id ?? "", bInstanceID: instances.find((i) => i.id !== (selected ?? instances[0]?.id))?.id ?? "" }); }, [open]);
  const issues = asBuiltJointDraftIssues(draft);
  const options = instances.map((i) => ({ value: i.id, label: i.name }));
  return (
    <Dialog open={open} title="As-built joint" onClose={close} actions={(<>
      <Button onClick={close}>Cancel</Button>
      <Button primary disabled={issues.length > 0} onClick={() => cadPresentation.dispatch({ type: "create-assembly-as-built-joint", draft })}>Create Joint</Button>
    </>)}>
      <div className="cad-start-form">
        <FieldRow label="Type" htmlFor="as-built-type">
          <SelectField id="as-built-type" value={draft.typeID} options={assemblyMateTypeOptions} onChange={(event) => setDraft({ ...draft, typeID: event.target.value as AssemblyMateTypeID })} />
        </FieldRow>
        <FieldRow label="Occurrence A" htmlFor="as-built-a">
          <SelectField id="as-built-a" value={draft.aInstanceID} options={options} onChange={(event) => setDraft({ ...draft, aInstanceID: event.target.value })} />
        </FieldRow>
        <FieldRow label="Occurrence B" htmlFor="as-built-b">
          <SelectField id="as-built-b" value={draft.bInstanceID} options={options} onChange={(event) => setDraft({ ...draft, bInstanceID: event.target.value })} />
        </FieldRow>
        <FieldRow label="Name" htmlFor="as-built-name">
          <TextField id="as-built-name" value={draft.name} placeholder="As-built joint" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </FieldRow>
        <p className="cad-form-note">Both occurrences keep their placement. The joint frame sits at B's origin along B's axis; a connector is added to each part so the mate is satisfied as built.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
