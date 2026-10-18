/** Author a Part-owned mate connector. */
import { type AssemblyConnectorDraft, type ConnectorAxisID, assemblyConnectorDraftIssues, connectorAxisOptions, defaultAssemblyConnectorDraft } from "../../cad-connector-authoring";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { CADQuantityField } from "../CADQuantityField";
import { Button, Dialog, FieldRow, SelectField, TextField } from "@aether/ui";
import { useState } from "react";

export function AssemblyConnectorDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const [draft, setDraft] = useState<AssemblyConnectorDraft>(defaultAssemblyConnectorDraft);
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  const issues = assemblyConnectorDraftIssues(draft);
  const setOrigin = (index: 0 | 1 | 2, value: number | null) => {
    if (value === null) return;
    setDraft((current) => {
      const origin = [...current.originM] as [number, number, number];
      origin[index] = value;
      return { ...current, originM: origin };
    });
  };
  return (
    <Dialog
      open={presentation.startDialog === "add-connector"}
      title="Add manual mate connector"
      onClose={close}
      actions={(
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            primary
            disabled={issues.length > 0}
            onClick={() => cadPresentation.dispatch({ type: "add-assembly-connector", draft })}
          >Add Connector</Button>
        </>
      )}
    >
      <div className="cad-start-form">
        <FieldRow label="Connector name" htmlFor="connector-name">
          <TextField id="connector-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </FieldRow>
        <FieldRow label="Frame label" htmlFor="connector-frame-label">
          <TextField id="connector-frame-label" value={draft.provenanceLabel} placeholder="Optional manual datum label" onChange={(event) => setDraft({ ...draft, provenanceLabel: event.target.value })} />
        </FieldRow>
        <FieldRow label="Origin X" htmlFor="connector-origin-x">
          <CADQuantityField family="length" id="connector-origin-x" value={draft.originM[0]} step={0.001}  scrubLabel="Origin X" onValueChange={(value) => setOrigin(0, value)} />
        </FieldRow>
        <FieldRow label="Origin Y" htmlFor="connector-origin-y">
          <CADQuantityField family="length" id="connector-origin-y" value={draft.originM[1]} step={0.001}  scrubLabel="Origin Y" onValueChange={(value) => setOrigin(1, value)} />
        </FieldRow>
        <FieldRow label="Origin Z" htmlFor="connector-origin-z">
          <CADQuantityField family="length" id="connector-origin-z" value={draft.originM[2]} step={0.001}  scrubLabel="Origin Z" onValueChange={(value) => setOrigin(2, value)} />
        </FieldRow>
        <FieldRow label="Primary axis" htmlFor="connector-primary-axis">
          <SelectField id="connector-primary-axis" value={draft.primaryAxis} options={connectorAxisOptions} onChange={(event) => setDraft({ ...draft, primaryAxis: event.target.value as ConnectorAxisID })} />
        </FieldRow>
        <FieldRow label="Secondary axis" htmlFor="connector-secondary-axis">
          <SelectField id="connector-secondary-axis" value={draft.secondaryAxis} options={connectorAxisOptions} onChange={(event) => setDraft({ ...draft, secondaryAxis: event.target.value as ConnectorAxisID })} />
        </FieldRow>
        <p className="cad-form-note">The origin is Part-local in meters. Core normalizes the two nonparallel axes into the persistent right-handed connector frame.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
