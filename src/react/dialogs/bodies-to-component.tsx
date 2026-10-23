/** Bodies (and sketches) out of one occurrence's part into new components or
 *  another occurrence's part: component.from_bodies, move_bodies, move_sketches. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { type BodiesToComponentDraft, bodiesToComponentDraftIssues, defaultBodiesToComponentDraft } from "../../cad-component-authoring";
import { Button, Checkbox, Dialog, FieldRow, SelectField, TextField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export function BodiesToComponentDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const contents = assembly.data?.componentContents ?? [];
  const selected = assembly.data?.selectedInstanceID ?? null;
  const [draft, setDraft] = useState<BodiesToComponentDraft>(defaultBodiesToComponentDraft());
  const open = presentation.startDialog === "bodies-to-component";
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  useEffect(() => { if (open) setDraft(defaultBodiesToComponentDraft(selected ?? contents[0]?.id ?? "")); }, [open]);
  const source = contents.find((c) => c.id === draft.sourceInstanceID);
  const issues = bodiesToComponentDraftIssues(draft);
  const toggle = (key: "bodyIDs" | "sketchIDs", id: string, checked: boolean) => setDraft({ ...draft, [key]: checked ? [...draft[key], id] : draft[key].filter((item) => item !== id) });
  const occurrenceOptions = contents.map((c) => ({ value: c.id, label: c.name }));
  return (
    <Dialog open={open} title="Bodies to component" onClose={close} actions={(<>
      <Button onClick={close}>Cancel</Button>
      <Button primary disabled={issues.length > 0} onClick={() => cadPresentation.dispatch({ type: "move-bodies-to-component", draft })}>{draft.target === "new" ? "Create Components" : "Move"}</Button>
    </>)}>
      <div className="cad-start-form">
        <FieldRow label="From" htmlFor="bodies-source">
          <SelectField id="bodies-source" value={draft.sourceInstanceID} options={occurrenceOptions} onChange={(event) => setDraft({ ...defaultBodiesToComponentDraft(event.target.value), target: draft.target })} />
        </FieldRow>
        <fieldset className="cad-contact-occurrences" aria-label="Bodies">
          {source?.bodies.map((body) => <Checkbox key={body.id} checked={draft.bodyIDs.includes(body.id)} onChange={(event) => toggle("bodyIDs", body.id, event.target.checked)} label={body.name} />)}
          {source && !source.bodies.length ? <p className="cad-form-note">This part has no bodies to move.</p> : null}
        </fieldset>
        <fieldset className="cad-contact-occurrences" aria-label="Sketches">
          {source?.sketches.map((sketch) => <Checkbox key={sketch.id} checked={draft.sketchIDs.includes(sketch.id)} onChange={(event) => toggle("sketchIDs", sketch.id, event.target.checked)} label={sketch.name} />)}
        </fieldset>
        <FieldRow label="To" htmlFor="bodies-target">
          <SelectField id="bodies-target" value={draft.target} options={[{ value: "new", label: "New component per body" }, ...occurrenceOptions.filter((o) => o.value !== draft.sourceInstanceID)]} onChange={(event) => setDraft({ ...draft, target: event.target.value })} />
        </FieldRow>
        {draft.target === "new" ? (
          <FieldRow label="Name" htmlFor="bodies-name">
            <TextField id="bodies-name" value={draft.name} placeholder="Named after each body" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </FieldRow>
        ) : null}
        <p className="cad-form-note">A body takes the features it needs; a sketch two bodies share is copied, not stolen. Every occurrence of the source part loses the moved bodies.</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
