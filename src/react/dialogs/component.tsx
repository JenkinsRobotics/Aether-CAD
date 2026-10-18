/** Insert an Assembly component: identity, units, mass and grounding. */
import { type AssemblyComponentDraft, assemblyComponentDraftIssues, defaultAssemblyComponentDraft } from "../../cad-assembly-authoring";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { CADQuantityField } from "../CADQuantityField";
import { Button, Checkbox, Dialog, FieldRow, TextField } from "@aether/ui";
import { useState } from "react";

export function AssemblyComponentDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const [draft, setDraft] = useState<AssemblyComponentDraft>(defaultAssemblyComponentDraft);
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  const issues = assemblyComponentDraftIssues(draft);
  const setPosition = (index: 0 | 1 | 2, value: number | null) => {
    if (value === null) return;
    setDraft((current) => {
      const position = [...current.positionM] as [number, number, number];
      position[index] = value;
      return { ...current, positionM: position };
    });
  };
  return (
    <Dialog
      open={presentation.startDialog === "insert-component"}
      title="Insert Assembly component"
      onClose={close}
      actions={(
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            primary
            disabled={issues.length > 0}
            onClick={() => cadPresentation.dispatch({ type: "insert-assembly-component", draft })}
          >Insert Component</Button>
        </>
      )}
    >
      <div className="cad-start-form">
        <FieldRow label="Part name" htmlFor="assembly-part-name">
          <TextField id="assembly-part-name" value={draft.partName} onChange={(event) => setDraft({ ...draft, partName: event.target.value })} />
        </FieldRow>
        <FieldRow label="Part number" htmlFor="assembly-part-number">
          <TextField id="assembly-part-number" value={draft.partNumber} placeholder="Optional" onChange={(event) => setDraft({ ...draft, partNumber: event.target.value })} />
        </FieldRow>
        <FieldRow label="Source label" htmlFor="assembly-source-label">
          <TextField id="assembly-source-label" value={draft.sourceLabel} onChange={(event) => setDraft({ ...draft, sourceLabel: event.target.value })} />
        </FieldRow>
        <FieldRow label="Instance name" htmlFor="assembly-instance-name">
          <TextField id="assembly-instance-name" value={draft.instanceName} onChange={(event) => setDraft({ ...draft, instanceName: event.target.value })} />
        </FieldRow>
        <FieldRow label="Mass" htmlFor="assembly-mass-kg">
          <CADQuantityField family="mass" id="assembly-mass-kg" value={draft.massKg} min={0} step={0.01}  scrubLabel="Mass" onValueChange={(massKg) => setDraft({ ...draft, massKg })} />
        </FieldRow>
        <FieldRow label="Position X" htmlFor="assembly-position-x">
          <CADQuantityField family="length" id="assembly-position-x" value={draft.positionM[0]} step={0.01}  scrubLabel="Position X" onValueChange={(value) => setPosition(0, value)} />
        </FieldRow>
        <FieldRow label="Position Y" htmlFor="assembly-position-y">
          <CADQuantityField family="length" id="assembly-position-y" value={draft.positionM[1]} step={0.01}  scrubLabel="Position Y" onValueChange={(value) => setPosition(1, value)} />
        </FieldRow>
        <FieldRow label="Position Z" htmlFor="assembly-position-z">
          <CADQuantityField family="length" id="assembly-position-z" value={draft.positionM[2]} step={0.01}  scrubLabel="Position Z" onValueChange={(value) => setPosition(2, value)} />
        </FieldRow>
        <Checkbox
          checked={draft.grounded}
          onChange={(event) => setDraft({ ...draft, grounded: event.target.checked })}
          label="Ground component"
          description="Fix this instance at its authored rest transform."
        />
        <p className="cad-form-note">The canonical Core creates the Part definition and stable Assembly instance. Viewport geometry remains dependent on a resolved source asset.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
