/** Relate two mates — gears, racks and screws. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { type AssemblyRelationDraft, type AssemblyRelationKind, assemblyRelationDraftIssues, assemblyRelationKindOptions, defaultAssemblyRelationDraft, relationKinds } from "../../cad-relation-authoring";
import { Button, Checkbox, Dialog, FieldRow, NumberField, SelectField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export function AssemblyRelationDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const options = assembly.data?.relationDOFOptions ?? [];
  const [draft, setDraft] = useState<AssemblyRelationDraft>(defaultAssemblyRelationDraft);
  const open = presentation.startDialog === "create-relation";
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });

  const defaultsFor = (kind: AssemblyRelationKind, current: AssemblyRelationDraft): AssemblyRelationDraft => {
    const expected = relationKinds(kind);
    const drivers = options.filter((option) => option.kind === expected.driverKind);
    const driverDOFID = drivers.some(({ id }) => id === current.driverDOFID)
      ? current.driverDOFID : drivers[0]?.id ?? "";
    const driven = options.filter((option) => option.kind === expected.drivenKind && option.id !== driverDOFID);
    const drivenDOFID = driven.some(({ id }) => id === current.drivenDOFID)
      ? current.drivenDOFID : driven[0]?.id ?? "";
    return { ...current, kind, driverDOFID, drivenDOFID };
  };

  useEffect(() => {
    if (open) setDraft((current) => defaultsFor(current.kind, current));
  }, [open, assembly.data?.revision]);

  const expected = relationKinds(draft.kind);
  const driverOptions = options
    .filter(({ kind }) => kind === expected.driverKind)
    .map(({ id, label }) => ({ value: id, label }));
  const drivenOptions = options
    .filter(({ kind, id }) => kind === expected.drivenKind && id !== draft.driverDOFID)
    .map(({ id, label }) => ({ value: id, label }));
  const issues = assemblyRelationDraftIssues(draft, options);
  const mixedUnits = expected.driverKind !== expected.drivenKind;
  const offsetUnit = expected.drivenKind === "rotation" ? "°" : "m";

  return (
    <Dialog
      open={open}
      title="Create DOF relation"
      onClose={close}
      actions={(
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            primary
            disabled={issues.length > 0}
            onClick={() => cadPresentation.dispatch({ type: "create-assembly-relation", draft })}
          >Create Relation</Button>
        </>
      )}
    >
      <div className="cad-start-form">
        <FieldRow label="Type" htmlFor="assembly-relation-kind">
          <SelectField
            id="assembly-relation-kind"
            value={draft.kind}
            options={assemblyRelationKindOptions}
            onChange={(event) => setDraft(defaultsFor(event.target.value as AssemblyRelationKind, draft))}
          />
        </FieldRow>
        <FieldRow label="Driver DOF" htmlFor="assembly-relation-driver">
          <SelectField id="assembly-relation-driver" value={draft.driverDOFID} options={driverOptions} onChange={(event) => setDraft(defaultsFor(draft.kind, { ...draft, driverDOFID: event.target.value, drivenDOFID: "" }))} />
        </FieldRow>
        <FieldRow label="Driven DOF" htmlFor="assembly-relation-driven">
          <SelectField id="assembly-relation-driven" value={draft.drivenDOFID} options={drivenOptions} onChange={(event) => setDraft({ ...draft, drivenDOFID: event.target.value })} />
        </FieldRow>
        <FieldRow label={mixedUnits ? "Ratio (m/rad)" : "Ratio"} htmlFor="assembly-relation-ratio">
          <NumberField id="assembly-relation-ratio" value={draft.ratio} min={0.000001} step={0.1} precision={6} scrubLabel="Ratio" onValueChange={(ratio) => setDraft({ ...draft, ratio })} />
        </FieldRow>
        <FieldRow label="Driven offset" htmlFor="assembly-relation-offset">
          <NumberField id="assembly-relation-offset" value={draft.offset} step={expected.drivenKind === "rotation" ? 1 : 0.001} precision={6} unit={offsetUnit} scrubLabel="Driven offset" onValueChange={(offset) => setDraft({ ...draft, offset })} />
        </FieldRow>
        <Checkbox checked={draft.reversed} onChange={(event) => setDraft({ ...draft, reversed: event.target.checked })} label="Reverse direction" description="Core receives a negative ratio while preserving this presentation flag." />
        <p className="cad-form-note">Core validates unit pairing, dependency ownership, solve order, and the driven value. Mixed rotation-to-translation ratios are authored in meters per radian.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
