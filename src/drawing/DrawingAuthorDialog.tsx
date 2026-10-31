import { useState } from "react";
import { Button, Checkbox, Dialog, FieldRow, SelectField } from "@aether/ui";
import { drawingOrientations, type DrawingAnnotation, type DrawingCommand, type DrawingDocument, type DrawingView } from "@aether/core/drawing";

/** One "Label: value" row per line. ponytail: a textarea instead of a row editor. */
const parseTitleBlock = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean).map(line => { const i = line.indexOf(":"); return i < 0 ? { label: line, value: "" } : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }; });

export interface DrawingDialogDraft { kind: "sheet" | "view" | "annotation"; editId?: string; section?: boolean }
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
  const [section, setSection] = useState(!!view?.section || !!draft.section);
  const [cutOffset, setCutOffset] = useState(view?.section?.offsetMm ?? 0);
  const [hatchSpacing, setHatchSpacing] = useState(view?.section?.hatchSpacingMm ?? 2);
  const [hidden, setHidden] = useState(view?.hiddenLines ?? true);
  const [viewKind, setViewKind] = useState<"standard" | "auxiliary" | "detail">(view?.detail ? "detail" : view?.direction ? "auxiliary" : "standard");
  const [direction, setDirection] = useState<[number, number, number]>(view?.direction ?? [1, -1, 1]);
  const [detailParent, setDetailParent] = useState(view?.detail?.parentId ?? sheet.views.find(v => !v.detail && v.id !== draft.editId)?.id ?? "");
  const [detailCenter, setDetailCenter] = useState<[number, number]>(view?.detail?.centerMm ?? [sheet.widthMm / 2, sheet.heightMm / 2]);
  const [detailRadius, setDetailRadius] = useState(view?.detail?.radiusMm ?? 10);
  const [detailLabel, setDetailLabel] = useState(view?.detail?.label ?? String.fromCharCode(65 + sheet.views.filter(v => v.detail).length));
  const [titleBlock, setTitleBlock] = useState((sheet.titleBlock ?? []).map(row => `${row.label}: ${row.value}`).join("\n"));
  const [width, setWidth] = useState(sheet.widthMm), [height, setHeight] = useState(sheet.heightMm);
  const [projection, setProjection] = useState(sheet.projection);
  const [kind, setKind] = useState<DrawingAnnotation["kind"]>(annotation?.kind ?? "note");
  const [text, setText] = useState(annotation?.kind === "note" || annotation?.kind === "balloon" ? annotation.text : "");
  const [viewId, setViewId] = useState(annotation && annotation.kind !== "note" && annotation.kind !== "balloon" ? annotation.viewId : sheet.views[0]?.id ?? "");
  const [decimals, setDecimals] = useState(annotation && "decimals" in annotation ? annotation.decimals : 2);
  const [leader, setLeader] = useState<[number, number]>(annotation?.kind === "balloon" ? annotation.leaderMm : [sheet.widthMm / 2, sheet.heightMm / 2]);
  const attached = annotation && (annotation.kind === "diameter" || annotation.kind === "radius" || annotation.kind === "angle" || annotation.kind === "center-mark") ? annotation : undefined;
  const [atX, setAtX] = useState(attached?.atMm[0] ?? sheet.widthMm / 2), [atY, setAtY] = useState(attached?.atMm[1] ?? sheet.heightMm / 2);
  const [toX, setToX] = useState(attached?.kind === "angle" ? attached.toMm[0] : sheet.widthMm / 2), [toY, setToY] = useState(attached?.kind === "angle" ? attached.toMm[1] : sheet.heightMm / 2);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const numberField = (id: string, label: string, value: number, change: (n: number) => void) => <FieldRow label={label} htmlFor={`drawing-${id}`}><input id={`drawing-${id}`} type="number" step="any" disabled={busy} value={Number.isFinite(value) ? value : ""} onChange={e => change(e.target.value === "" ? NaN : Number(e.target.value))}/></FieldRow>;
  const run = async () => {
    setBusy(true); setError("");
    try {
      const id = draft.editId ?? crypto.randomUUID();
      let command: DrawingCommand;
      if (draft.kind === "sheet") command = draft.editId
        ? { type: "update-sheet", sheetId: id, name, widthMm: width, heightMm: height, projection, titleBlock: parseTitleBlock(titleBlock) }
        : { type: "add-sheet", sheet: { id, name, widthMm: width, heightMm: height, projection, views: [], annotations: [], ...(titleBlock.trim() ? { titleBlock: parseTitleBlock(titleBlock) } : {}) } };
      else if (draft.kind === "view") {
        const standard = viewKind === "standard";
        const changes: Omit<DrawingView, "id"> = { name, orientation, originMm: [x, y], scale, hiddenLines: hidden, section: standard && section ? {offsetMm: cutOffset, hatchSpacingMm: hatchSpacing} : null, parentId: standard && parentId ? parentId : undefined, ...(view?.bodyIds ? { bodyIds: view.bodyIds } : {}),
          direction: viewKind === "auxiliary" ? direction : null, detail: viewKind === "detail" ? { parentId: detailParent, centerMm: detailCenter, radiusMm: detailRadius, label: detailLabel } : null };
        command = draft.editId ? { type: "update-view", sheetId: sheet.id, viewId: id, changes } : { type: "add-view", sheetId: sheet.id, view: { ...changes, id } };
      } else {
        const annotation: DrawingAnnotation = kind === "note" ? { id, kind, text, positionMm: [x, y] }
          : kind === "balloon" ? { id, kind, text, positionMm: [x, y], leaderMm: leader }
          : kind === "center-mark" ? { id, kind, viewId, positionMm: [atX, atY], atMm: [atX, atY] }
          : kind === "angle" ? { id, kind, viewId, decimals, positionMm: [x, y], atMm: [atX, atY], toMm: [toX, toY] }
          : kind === "diameter" || kind === "radius" ? { id, kind, viewId, decimals, positionMm: [x, y], atMm: [atX, atY] }
          : { id, kind, viewId, decimals, positionMm: [x, y] };
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
      <FieldRow label="Title block" htmlFor="drawing-title-block"><textarea id="drawing-title-block" rows={4} disabled={busy} value={titleBlock} placeholder={"Drawn by: name\nMaterial: 6061-T6"} onChange={e => setTitleBlock(e.target.value)}/></FieldRow>
      <FieldRow label="Projection" htmlFor="drawing-projection"><SelectField id="drawing-projection" value={projection} disabled={busy} options={[{ value: "third_angle", label: "Third angle" }, { value: "first_angle", label: "First angle" }]} onChange={e => setProjection(e.target.value as typeof projection)}/></FieldRow>
    </> : <>
      {draft.kind === "view" ? <>
        <FieldRow label="View type" htmlFor="drawing-view-kind"><SelectField id="drawing-view-kind" value={viewKind} disabled={busy} options={[{ value: "standard", label: "Standard" }, { value: "auxiliary", label: "Auxiliary (custom direction)" }, { value: "detail", label: "Detail (enlarged circle)" }]} onChange={e => { setViewKind(e.target.value as typeof viewKind); if (!view && e.target.value === "detail") setName(`Detail ${detailLabel}`); }}/></FieldRow>
        {viewKind === "auxiliary" && <>
          {numberField("dir-x", "View direction X (model)", direction[0], n => setDirection([n, direction[1], direction[2]]))}{numberField("dir-y", "View direction Y (model)", direction[1], n => setDirection([direction[0], n, direction[2]]))}{numberField("dir-z", "View direction Z (model)", direction[2], n => setDirection([direction[0], direction[1], n]))}
          <p>Looks along the direction toward the viewer with world Z up on paper, e.g. the normal of an inclined face.</p>
        </>}
        {viewKind === "detail" && <>
          <FieldRow label="Enlarges" htmlFor="drawing-detail-parent"><SelectField id="drawing-detail-parent" value={detailParent} disabled={busy} options={sheet.views.filter(v => !v.detail && v.id !== draft.editId).map(v => ({ value: v.id, label: v.name }))} onChange={e => setDetailParent(e.target.value)}/></FieldRow>
          {numberField("detail-cx", "Circle centre X on parent (sheet mm)", detailCenter[0], n => setDetailCenter([n, detailCenter[1]]))}{numberField("detail-cy", "Circle centre Y on parent (sheet mm)", detailCenter[1], n => setDetailCenter([detailCenter[0], n]))}
          {numberField("detail-radius", "Circle radius (sheet mm)", detailRadius, setDetailRadius)}
          <FieldRow label="Marker letter" htmlFor="drawing-detail-label"><input id="drawing-detail-label" value={detailLabel} disabled={busy} onChange={e => setDetailLabel(e.target.value)}/></FieldRow>
        </>}
        {viewKind === "standard" && <FieldRow label="Orientation" htmlFor="drawing-orientation"><SelectField id="drawing-orientation" value={orientation} disabled={busy} options={drawingOrientations.filter(value => !section || value !== "isometric").map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={e => { setOrientation(e.target.value as typeof orientation); if (!view) setName(e.target.value[0].toUpperCase() + e.target.value.slice(1)); }}/></FieldRow>}
        {viewKind === "standard" && <FieldRow label="Projected from" htmlFor="drawing-parent"><SelectField id="drawing-parent" value={parentId} disabled={busy || section} options={[{ value: "", label: "Independent base view" }, ...sheet.views.filter(v => v.orientation === "front" && !v.section && !v.parentId && v.id !== draft.editId).map(v => ({ value: v.id, label: v.name }))]} onChange={e => setParent(e.target.value)}/></FieldRow>}
        {viewKind === "standard" && parentId ? <p>Projected views inherit their front view's scale and alignment. Choose top, bottom, left or right.</p> : numberField("scale", "Scale ratio", scale, setScale)}
        {viewKind === "standard" && <Checkbox label="Section view" checked={section} disabled={busy || !!parentId || orientation === "isometric"} onChange={e => setSection(e.target.checked)}/>}
        {viewKind === "standard" && section && <>
          {numberField("cut-offset", `Cut ${["top", "bottom"].includes(orientation) ? "Z" : ["left", "right"].includes(orientation) ? "X" : "Y"} (model mm)`, cutOffset, setCutOffset)}
          {numberField("hatch-spacing", "Hatch spacing (paper mm)", hatchSpacing, setHatchSpacing)}
          <p>Removes material nearest the viewer. Choose a cut inside the solid; holes stay clear. Principal views only.</p>
        </>}
        <Checkbox label="Show hidden edges" checked={hidden} disabled={busy} onChange={e => setHidden(e.target.checked)}/>
      </> : <>
        <FieldRow label="Annotation" htmlFor="drawing-annotation-kind"><SelectField id="drawing-annotation-kind" value={kind} disabled={busy} options={[{ value: "note", label: "Note" }, { value: "width", label: "Overall width dimension" }, { value: "height", label: "Overall height dimension" }, { value: "diameter", label: "Diameter dimension" }, { value: "radius", label: "Radius dimension" }, { value: "angle", label: "Angle dimension" }, { value: "balloon", label: "Balloon" }, { value: "center-mark", label: "Centre mark" }]} onChange={e => setKind(e.target.value as typeof kind)}/></FieldRow>
        {kind === "note" || kind === "balloon" ? <>
          <FieldRow label="Text" htmlFor="drawing-note"><input id="drawing-note" value={text} disabled={busy} onChange={e => setText(e.target.value)}/></FieldRow>
          {kind === "balloon" && <>{numberField("leader-x", "Leader tip X (sheet mm)", leader[0], n => setLeader([n, leader[1]]))}{numberField("leader-y", "Leader tip Y (sheet mm)", leader[1], n => setLeader([leader[0], n]))}</>}
        </> : <>
          <FieldRow label="View" htmlFor="drawing-dimension-view"><SelectField id="drawing-dimension-view" value={viewId} disabled={busy} options={sheet.views.map(v => ({ value: v.id, label: v.name }))} onChange={e => setViewId(e.target.value)}/></FieldRow>
          {kind !== "center-mark" && numberField("decimals", "Decimal places", decimals, setDecimals)}
          {(kind === "diameter" || kind === "radius" || kind === "angle" || kind === "center-mark") && <>
            {numberField("at-x", kind === "angle" ? "First edge pick X (sheet mm)" : "Circle pick X (sheet mm)", atX, setAtX)}{numberField("at-y", kind === "angle" ? "First edge pick Y (sheet mm)" : "Circle pick Y (sheet mm)", atY, setAtY)}
            {kind === "angle" && <>{numberField("to-x", "Second edge pick X (sheet mm)", toX, setToX)}{numberField("to-y", "Second edge pick Y (sheet mm)", toY, setToY)}</>}
          </>}
          <p>{kind === "width" || kind === "height" ? "The dimension measures the view's overall geometric extent in model millimeters. It updates when the source Part is rebuilt."
            : kind === "center-mark" ? "Centre lines cross the projected circle or arc nearest the pick (within 5 mm on the sheet)."
            : kind === "angle" ? "The angle is measured between the straight edges nearest the two picks (within 5 mm on the sheet), in the sector the picks span. It updates when the source Part is rebuilt."
            : "The dimension attaches to the projected circle or arc nearest the pick (within 5 mm on the sheet) and shows the model value. It updates when the source Part is rebuilt."}</p>
        </>}
      </>}
      {kind !== "center-mark" || draft.kind !== "annotation" ? <>{numberField("x", "Sheet X (mm)", x, setX)}{numberField("y", "Sheet Y (mm)", y, setY)}</> : null}
    </>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}
