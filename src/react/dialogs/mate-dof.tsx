/** Drive and limit a mate's degrees of freedom. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type AssemblyMateDOFEditorDraft, assemblyMateDOFEditorDraft, assemblyMateDOFEditorIssues } from "../../cad-mate-authoring";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { CADQuantityField } from "../CADQuantityField";
import { Button, Checkbox, Dialog, FieldRow, SelectField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export function AssemblyMateDOFDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const valueMode = presentation.startDialog === "set-mate-dof-value";
  const limitsMode = presentation.startDialog === "edit-mate-dof-limits";
  const open = valueMode || limitsMode;
  const [draft, setDraft] = useState<AssemblyMateDOFEditorDraft | null>(null);
  const dofs = assembly.data?.selectedMateDOFs ?? (assembly.data?.selectedMateDOF ? [assembly.data.selectedMateDOF] : []);
  const coordinateIDs = dofs.map(dof => dof.id).join("\n");
  const selectedDOF = dofs.find(dof => dof.id === draft?.dofID);
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });

  useEffect(() => {
    if (open) setDraft(current => {
      const dof = dofs.find(dof => dof.id === current?.dofID) ?? dofs[0];
      return dof ? assemblyMateDOFEditorDraft(dof) : null;
    });
  }, [open, coordinateIDs, assembly.data?.revision]);

  const mode = valueMode ? "value" : "limits";
  const issues = draft && selectedDOF ? assemblyMateDOFEditorIssues(draft, mode) : ["Select one editable mate DOF."];
  const rotation = draft?.kind === "rotation";
  
  const step = rotation ? 1 : 0.001;
  const precision = rotation ? 3 : 6;
  const enableLimits = (enabled: boolean) => {
    if (!draft) return;
    setDraft({
      ...draft,
      limitsEnabled: enabled,
      minimum: enabled ? draft.minimum ?? (rotation ? -90 : -0.1) : null,
      maximum: enabled ? draft.maximum ?? (rotation ? 90 : 0.1) : null,
    });
  };

  return (
    <Dialog
      open={open}
      title={valueMode ? "Set mate DOF value" : "Edit mate DOF limits"}
      onClose={close}
      actions={(
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            primary
            disabled={!draft || issues.length > 0}
            onClick={() => {
              if (!draft) return;
              cadPresentation.dispatch(valueMode
                ? { type: "set-assembly-mate-dof-value", draft }
                : { type: "update-assembly-mate-dof-limits", draft });
            }}
          >{valueMode ? "Set Value" : "Apply Limits"}</Button>
        </>
      )}
    >
      <div className="cad-start-form">
        {draft && selectedDOF ? (
          <>
            <FieldRow label="Coordinate" htmlFor="assembly-mate-coordinate">
              <SelectField id="assembly-mate-coordinate" value={draft.dofID}
                options={dofs.map(dof => ({ value: dof.id, label: `${dof.name} · ${dof.kind === "rotation" ? "Rotation" : "Translation"}` }))}
                onChange={event => {
                  const dof = dofs.find(dof => dof.id === event.target.value);
                  if (dof) setDraft(assemblyMateDOFEditorDraft(dof));
                }} />
            </FieldRow>
            {valueMode ? (
              <FieldRow label={rotation ? "Angle" : "Distance"} htmlFor="assembly-mate-dof-value">
                <CADQuantityField family={rotation?"angle":"length"} canonicalFactor={rotation?Math.PI/180:1}
                  id="assembly-mate-dof-value"
                  value={draft.value}
                  step={step}
                  precision={precision}
                  scrubLabel={rotation ? "Angle" : "Distance"}
                  onValueChange={(value) => setDraft({ ...draft, value })}
                />
              </FieldRow>
            ) : (
              <>
                <Checkbox
                  checked={draft.limitsEnabled}
                  onChange={(event) => enableLimits(event.target.checked)}
                  label="Enable authored limits"
                  description="Core reports, rather than silently clamps, values outside this range."
                />
                <FieldRow label="Minimum" htmlFor="assembly-mate-dof-minimum">
                  <CADQuantityField family={rotation?"angle":"length"} canonicalFactor={rotation?Math.PI/180:1}
                    id="assembly-mate-dof-minimum"
                    value={draft.minimum}
                    step={step}
                    precision={precision}
                      disabled={!draft.limitsEnabled}
                    scrubLabel="Minimum"
                    onValueChange={(minimum) => setDraft({ ...draft, minimum })}
                  />
                </FieldRow>
                <FieldRow label="Maximum" htmlFor="assembly-mate-dof-maximum">
                  <CADQuantityField family={rotation?"angle":"length"} canonicalFactor={rotation?Math.PI/180:1}
                    id="assembly-mate-dof-maximum"
                    value={draft.maximum}
                    step={step}
                    precision={precision}
                      disabled={!draft.limitsEnabled}
                    scrubLabel="Maximum"
                    onValueChange={(maximum) => setDraft({ ...draft, maximum })}
                  />
                </FieldRow>
              </>
            )}
            <p className="cad-form-note">Uses workspace display units. Core retains angles in radians and distances in meters.</p>
          </>
        ) : <p className="cad-form-note" role="alert">The selected mate no longer exposes an editable free DOF.</p>}
        {issues.length > 0 && draft ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
