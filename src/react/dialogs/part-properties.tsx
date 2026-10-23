/** Part properties of the selected occurrence's part (component.metadata.set). */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { type PartPropertiesDraft, partPropertiesDraftFrom, partPropertiesDraftIssues } from "../../cad-component-authoring";
import { Button, Dialog, FieldRow, TextField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

const empty: PartPropertiesDraft = { partNumber: "", description: "", properties: "" };

export function PartPropertiesDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const definition = assembly.data?.selectedPartDefinition ?? null;
  const [draft, setDraft] = useState<PartPropertiesDraft>(empty);
  const open = presentation.startDialog === "part-properties";
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  useEffect(() => { if (open) setDraft(definition ? partPropertiesDraftFrom(definition) : empty); }, [open, definition?.id]);
  const issues = definition ? partPropertiesDraftIssues(draft) : ["Select one occurrence in the assembly tree."];
  return (
    <Dialog open={open} title={definition ? `Part properties · ${definition.name}` : "Part properties"} onClose={close} actions={(<>
      <Button onClick={close}>Cancel</Button>
      <Button primary disabled={issues.length > 0} onClick={() => cadPresentation.dispatch({ type: "update-part-properties", draft })}>Apply</Button>
    </>)}>
      <div className="cad-start-form">
        <FieldRow label="Part number" htmlFor="part-number">
          <TextField id="part-number" value={draft.partNumber} onChange={(event) => setDraft({ ...draft, partNumber: event.target.value })} />
        </FieldRow>
        <FieldRow label="Description" htmlFor="part-description">
          <TextField id="part-description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </FieldRow>
        <FieldRow label="Properties" htmlFor="part-custom-properties">
          <textarea id="part-custom-properties" className="cad-textarea" rows={5} spellCheck={false} placeholder={"finish = anodised\nvendor = Acme"} value={draft.properties} onChange={(event) => setDraft({ ...draft, properties: event.target.value })} />
        </FieldRow>
        <p className="cad-form-note">One property per line as key = value. The BOM and Studio read these; revision belongs to Studio releases.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
