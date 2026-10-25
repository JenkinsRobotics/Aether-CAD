import { useState } from "react";
import { Button, Checkbox, Dialog, FieldRow, SelectField } from "@aether/ui";
import { drawingOrientations, type DrawingAnnotation, type DrawingCommand, type DrawingDocument, type DrawingView } from "@aether/core/drawing";

export interface DrawingDialogDraft { kind: "sheet" | "view" | "annotation"; editId?: string }
export function DrawingAuthorDialog({ draft, document, execute, onClose }: { draft: DrawingDialogDraft; document: DrawingDocument; execute: (command: DrawingCommand) => Promise<void>; onClose: () => void }) {
  const sheet = document.sheets.find(s => s.id === document.activeSheetId)!;
  const view = sheet.views.find(v => v.id === draft.editId);
  const annotation = sheet.annotations.find(a => a.id === draft.editId);
  const [name, setName] = useState(view?.name ?? (draft.editId ? sheet.name : draft.kind === "sheet" ? `Sheet ${document.sheets.length + 1}` : "Front"));
  const [orientation, setOrientation] = useState<DrawingView["orientation"]>(view?.orientation ?? "front");
  const [parentId, setParent] = useState(view?.parentId ?? "");
  const [x, setX] = useState(view?.originMm[0] ?? annotation?.positionMm[0] ?? sheet.widthMm / 2);
  const [y, setY] = useState(view?.originMm[1] ?? annotation?.positionMm[1] ?? sheet.heightMm / 2);
  const [scale, setScale] = useState(view?.scale ?? 1);
  const [hidden, setHidden] = useState(view?.hiddenLines ?? true);
  const [width, setWidth] = useState(sheet.widthMm), [height, setHeight] = useState(sheet.heightMm);
  const [projection, setProjection] = useState(sheet.projection);
  const [kind, setKind] = useState<DrawingAnnotation["kind"]>(annotation?.kind ?? "note");
  const [text, setText] = useState(annotation?.kind === "note" ? annotation.text : "");
  const [viewId, setViewId] = useState(annotation && annotation.kind !== "note" ? annotation.viewId : sheet.views[0]?.id ?? "");
  const [decimals, setDecimals] = useState(annotation && annotation.kind !== "note" ? annotation.decimals : 2);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const numberField = (id: string, label: string, value: number, change: (n: number) => void) => <FieldRow label={label} htmlFor={`drawing-${id}`}><input id={`drawing-${id}`} type="number" step="any" disabled={busy} value={Number.isFinite(value) ? value : ""} onChange={e => change(e.target.value === "" ? NaN : Number(e.target.value))}/></FieldRow>;
  const run = async () => {
    setBusy(true); setError("");
    try {
      const id = draft.editId ?? crypto.randomUUID();
      let command: DrawingCommand;
      if (draft.kind === "sheet") command = draft.editId
        ? { type: "update-sheet", sheetId: id, name, widthMm: width, heightMm: height, projection }
        : { type: "add-sheet", sheet: { id, name, widthMm: width, heightMm: height, projection, views: [], annotations: [] } };
      else if (draft.kind === "view") {
        const changes: Omit<DrawingView, "id"> = { name, orientation, originMm: [x, y], scale, hiddenLines: hidden, parentId: parentId || undefined, ...(view?.bodyIds ? { bodyIds: view.bodyIds } : {}) };
        command = draft.editId ? { type: "update-view", sheetId: sheet.id, viewId: id, changes } : { type: "add-view", sheetId: sheet.id, view: { ...changes, id } };
      } else {
        const annotation: DrawingAnnotation = kind === "note" ? { id, kind, text, positionMm: [x, y] } : { id, kind, viewId, decimals, positionMm: [x, y] };
        command = { type: draft.editId ? "update-annotation" : "add-annotation", sheetId: sheet.id, annotation };
      }
      await execute(command); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <Dialog open title={`${draft.editId ? "Edit" : "Add"} drawing ${draft.kind}`} onClose={() => { if (!busy) onClose(); }} actions={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button primary disabled={busy} onClick={() => void run()}>{busy ? "Rebuilding…" : draft.editId ? "Apply" : "Add"}</Button></>}>
    {draft.kind !== "annotation" && <FieldRow label="Name" htmlFor="drawing-name"><input id="drawing-name" value={name} disabled={busy} onChange={e => setName(e.target.value)}/></FieldRow>}
    {draft.kind === "sheet" ? <>
      {numberField("width", "Paper width (mm)", width, setWidth)}{numberField("height", "Paper height (mm)", height, setHeight)}
      <FieldRow label="Projection" htmlFor="drawing-projection"><SelectField id="drawing-projection" value={projection} disabled={busy} options={[{ value: "third_angle", label: "Third angle" }, { value: "first_angle", label: "First angle" }]} onChange={e => setProjection(e.target.value as typeof projection)}/></FieldRow>
    </> : <>
      {draft.kind === "view" ? <>
        <FieldRow label="Orientation" htmlFor="drawing-orientation"><SelectField id="drawing-orientation" value={orientation} disabled={busy} options={drawingOrientations.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={e => { setOrientation(e.target.value as typeof orientation); if (!view) setName(e.target.value[0].toUpperCase() + e.target.value.slice(1)); }}/></FieldRow>
        <FieldRow label="Projected from" htmlFor="drawing-parent"><SelectField id="drawing-parent" value={parentId} disabled={busy} options={[{ value: "", label: "Independent base view" }, ...sheet.views.filter(v => v.orientation === "front" && !v.parentId && v.id !== draft.editId).map(v => ({ value: v.id, label: v.name }))]} onChange={e => setParent(e.target.value)}/></FieldRow>
        {parentId ? <p>Projected views inherit their front view's scale and alignment. Choose top, bottom, left or right.</p> : numberField("scale", "Scale ratio", scale, setScale)}
        <Checkbox label="Show hidden edges" checked={hidden} disabled={busy} onChange={e => setHidden(e.target.checked)}/>
      </> : <>
        <FieldRow label="Annotation" htmlFor="drawing-annotation-kind"><SelectField id="drawing-annotation-kind" value={kind} disabled={busy} options={[{ value: "note", label: "Note" }, { value: "width", label: "Overall width dimension" }, { value: "height", label: "Overall height dimension" }]} onChange={e => setKind(e.target.value as typeof kind)}/></FieldRow>
        {kind === "note" ? <FieldRow label="Text" htmlFor="drawing-note"><input id="drawing-note" value={text} disabled={busy} onChange={e => setText(e.target.value)}/></FieldRow> : <>
          <FieldRow label="View" htmlFor="drawing-dimension-view"><SelectField id="drawing-dimension-view" value={viewId} disabled={busy} options={sheet.views.map(v => ({ value: v.id, label: v.name }))} onChange={e => setViewId(e.target.value)}/></FieldRow>
          {numberField("decimals", "Decimal places", decimals, setDecimals)}
          <p>The dimension measures the view's overall geometric extent in model millimeters. It updates when the source Part is rebuilt.</p>
        </>}
      </>}
      {numberField("x", "Sheet X (mm)", x, setX)}{numberField("y", "Sheet Y (mm)", y, setY)}
    </>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}
