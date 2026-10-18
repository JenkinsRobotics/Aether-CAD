/** Create a mate between two connectors, with its preview gate. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type AssemblyMateDraft, type AssemblyMateTypeID, assemblyMateDraftIssues, assemblyMateTypeOptions, canApplyAssemblyMate, defaultAssemblyMateDraft } from "../../cad-mate-authoring";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { Button, Dialog, FieldRow, SelectField, TextField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export function AssemblyMateDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const endpoints = assembly.data?.mateEndpointOptions ?? [];
  const [draft, setDraft] = useState<AssemblyMateDraft>(defaultAssemblyMateDraft);
  const open = presentation.startDialog === "create-mate";
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  const endpointDraft = (id: string) => {
    const option = endpoints.find((candidate) => candidate.id === id);
    return option
      ? { instanceID: option.instanceID, connectorDefinitionID: option.connectorDefinitionID }
      : { instanceID: "", connectorDefinitionID: "" };
  };
  const updateDraft = (next: AssemblyMateDraft) => {
    setDraft(next);
    cadPresentation.dispatch({ type: "clear-assembly-mate-preview" });
  };

  // Each mate kind is its own ribbon button, so the button says which kind it
  // opened with. Without this the dialog would always start on Fastened and
  // the thirteen buttons would all do the same thing.
  useEffect(() => {
    const chosen = (event: Event) => {
      const kind = (event as CustomEvent).detail as AssemblyMateTypeID;
      if (!assemblyMateTypeOptions.some((option) => option.value === kind)) return;
      const label = `${kind[0].toUpperCase()}${kind.slice(1)} 1`;
      setDraft((current) => ({ ...current, typeID: kind, name: label }));
    };
    window.addEventListener("aether-mate-kind", chosen);
    return () => window.removeEventListener("aether-mate-kind", chosen);
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => {
      const currentA = endpoints.find((option) => option.instanceID === current.endpointA.instanceID && option.connectorDefinitionID === current.endpointA.connectorDefinitionID);
      const endpointAOption = currentA ?? endpoints[0];
      const currentB = endpoints.find((option) => option.instanceID === current.endpointB.instanceID && option.connectorDefinitionID === current.endpointB.connectorDefinitionID && option.instanceID !== endpointAOption?.instanceID);
      const endpointBOption = currentB ?? endpoints.find((option) => option.instanceID !== endpointAOption?.instanceID);
      return {
        ...current,
        endpointA: endpointAOption
          ? { instanceID: endpointAOption.instanceID, connectorDefinitionID: endpointAOption.connectorDefinitionID }
          : { instanceID: "", connectorDefinitionID: "" },
        endpointB: endpointBOption
          ? { instanceID: endpointBOption.instanceID, connectorDefinitionID: endpointBOption.connectorDefinitionID }
          : { instanceID: "", connectorDefinitionID: "" },
      };
    });
  }, [open, assembly.data?.revision]);

  const issues = assemblyMateDraftIssues(draft);
  const endpointOptions = endpoints.map(({ id, label }) => ({ value: id, label }));
  const endpointAID = endpoints.find((option) => option.instanceID === draft.endpointA.instanceID && option.connectorDefinitionID === draft.endpointA.connectorDefinitionID)?.id ?? "";
  const endpointBID = endpoints.find((option) => option.instanceID === draft.endpointB.instanceID && option.connectorDefinitionID === draft.endpointB.connectorDefinitionID)?.id ?? "";
  const preview = presentation.matePreview;
  const canApply = canApplyAssemblyMate(draft, assembly.data?.revision, preview);

  return (
    <Dialog
      open={open}
      title="Create Assembly mate"
      onClose={close}
      actions={(
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            disabled={issues.length > 0 || preview?.state === "loading"}
            onClick={() => cadPresentation.dispatch({ type: "preview-assembly-mate", draft })}
          >Preview Solve</Button>
          <Button
            primary
            disabled={!canApply}
            onClick={() => cadPresentation.dispatch({ type: "commit-assembly-mate", draft })}
          >Apply Mate</Button>
        </>
      )}
    >
      <div className="cad-start-form">
        <FieldRow label="Mate name" htmlFor="assembly-mate-name">
          <TextField id="assembly-mate-name" value={draft.name} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} />
        </FieldRow>
        <FieldRow label="Type" htmlFor="assembly-mate-type">
          <SelectField
            id="assembly-mate-type"
            value={draft.typeID}
            options={assemblyMateTypeOptions}
            onChange={(event) => {
              const typeID = event.target.value as AssemblyMateTypeID;
              const oldDefault = `${draft.typeID[0].toUpperCase()}${draft.typeID.slice(1)} 1`;
              const nextDefault = `${typeID[0].toUpperCase()}${typeID.slice(1)} 1`;
              updateDraft({ ...draft, typeID, name: draft.name === oldDefault ? nextDefault : draft.name });
            }}
          />
        </FieldRow>
        <FieldRow label="Moving endpoint" htmlFor="assembly-mate-endpoint-a">
          <SelectField
            id="assembly-mate-endpoint-a"
            value={endpointAID}
            options={endpointOptions}
            onChange={(event) => {
              const endpointA = endpointDraft(event.target.value);
              const endpointB = endpointA.instanceID === draft.endpointB.instanceID
                ? endpointDraft(endpoints.find((option) => option.instanceID !== endpointA.instanceID)?.id ?? "")
                : draft.endpointB;
              updateDraft({ ...draft, endpointA, endpointB });
            }}
          />
        </FieldRow>
        <FieldRow label="Target endpoint" htmlFor="assembly-mate-endpoint-b">
          <SelectField id="assembly-mate-endpoint-b" value={endpointBID} options={endpointOptions} onChange={(event) => updateDraft({ ...draft, endpointB: endpointDraft(event.target.value) })} />
        </FieldRow>
        <p className="cad-form-note">Preview is non-mutating. Apply remains disabled until Core solves the current endpoints and mate type.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
        {preview?.state === "loading" ? <p className="cad-form-note" role="status">{preview.message}</p> : null}
        {preview?.state === "error" ? <p className="cad-form-note" role="alert">{preview.message}</p> : null}
        {preview?.state === "ready" ? (
          <div className="cad-form-note" role="status">
            <strong>Preview {preview.solveStatus}</strong>
            <span>{preview.remainingFreeDOFCount} free DOF{preview.residual !== null && preview.residual !== undefined ? ` · residual ${preview.residual}` : ""}</span>
            {preview.diagnosticMessages?.map((message) => <span key={message}>{message}</span>)}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
