import { useState } from "react";
import { Button, Checkbox, Dialog, FieldRow, NumberField, SelectField, TextField } from "@aether/ui";
import {
  DRAWING_SHEET_TEMPLATES,
  drawingOrientations,
  gdtCharacteristicCodes,
  type DrawingAnnotation,
  type DrawingCommand,
  type DrawingDocument,
  type DrawingRevisionEntry,
  type DrawingView,
  type GdtCharacteristic,
} from "@aether/core/drawing";
import "../ui/CADPopups.css";

/** One "Label: value" row per line. */
const parseTitleBlock = (text: string) =>
  text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(":");
    return i < 0 ? { label: line, value: "" } : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  });

/** One "Rev | Description | Date | Author" row per line. */
const parseRevisions = (text: string): DrawingRevisionEntry[] =>
  text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split("|").map((s) => s.trim());
    return {
      rev: parts[0] || "A",
      description: parts[1] || "Revision",
      date: parts[2] || new Date().toISOString().slice(0, 10),
      ...(parts[3] ? { author: parts[3] } : {}),
    };
  });

const DIMENSION_KINDS = new Set(["width", "height", "diameter", "radius", "angle", "length", "point-distance", "point-angle", "ordinate"]);

export interface DrawingDialogDraft { kind: "sheet" | "view" | "annotation"; editId?: string; section?: boolean }

export function DrawingAuthorDialog({
  draft,
  document,
  execute,
  onClose,
}: {
  draft: DrawingDialogDraft;
  document: DrawingDocument;
  execute: (command: DrawingCommand) => Promise<void>;
  onClose: () => void;
}) {
  const sheet = document.sheets.find((s) => s.id === document.activeSheetId)!;
  const view = sheet.views.find((v) => v.id === draft.editId);
  const annotation = sheet.annotations.find((a) => a.id === draft.editId);
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
  const [viewKind, setViewKind] = useState<"standard" | "auxiliary" | "detail" | "flat-pattern">(
    view?.flatPattern ? "flat-pattern" : view?.detail ? "detail" : view?.direction ? "auxiliary" : "standard",
  );
  const [direction, setDirection] = useState<[number, number, number]>(view?.direction ?? [1, -1, 1]);
  const [detailParent, setDetailParent] = useState(view?.detail?.parentId ?? sheet.views.find((v) => !v.detail && v.id !== draft.editId)?.id ?? "");
  const [detailCenter, setDetailCenter] = useState<[number, number]>(view?.detail?.centerMm ?? [sheet.widthMm / 2, sheet.heightMm / 2]);
  const [detailRadius, setDetailRadius] = useState(view?.detail?.radiusMm ?? 10);
  const [detailLabel, setDetailLabel] = useState(view?.detail?.label ?? String.fromCharCode(65 + sheet.views.filter((v) => v.detail).length));
  const [templateId, setTemplateId] = useState("");
  const [titleBlock, setTitleBlock] = useState((sheet.titleBlock ?? []).map((row) => `${row.label}: ${row.value}`).join("\n"));
  const [revisionsText, setRevisionsText] = useState((sheet.revisions ?? []).map((r) => [r.rev, r.description, r.date, r.author ?? ""].filter(Boolean).join(" | ")).join("\n"));
  const [showRevisionTable, setShowRevisionTable] = useState(Boolean(sheet.revisionTable));
  const [width, setWidth] = useState(sheet.widthMm);
  const [height, setHeight] = useState(sheet.heightMm);
  const [projection, setProjection] = useState(sheet.projection);
  const [kind, setKind] = useState<DrawingAnnotation["kind"] | "chain">(annotation?.kind ?? "note");
  const [pointPicks, setPointPicks] = useState(annotation && "pointsMm" in annotation ? annotation.pointsMm.map((point) => point.join(", ")).join("\n") : "");
  const [pointAxis, setPointAxis] = useState<"aligned" | "x" | "y">(annotation && "axis" in annotation ? annotation.axis ?? "aligned" : "aligned");
  const [text, setText] = useState(
    annotation?.kind === "note" || annotation?.kind === "balloon" || annotation?.kind === "leader-note" || annotation?.kind === "chamfer-note"
      ? annotation.text
      : annotation?.kind === "datum" ? annotation.label
      : annotation?.kind === "revision-tag" ? annotation.revision
      : annotation?.kind === "gdt" ? annotation.tolerance
      : annotation?.kind === "surface-texture" ? annotation.ra
      : annotation?.kind === "weld-symbol" ? annotation.size ?? "3"
      : annotation?.kind === "hole-callout" ? annotation.text ?? ""
      : "",
  );
  const [gdtChar, setGdtChar] = useState<GdtCharacteristic>(annotation?.kind === "gdt" ? annotation.characteristic : "position");
  const [gdtDatums, setGdtDatums] = useState(annotation?.kind === "gdt" ? (annotation.datums ?? []).join(", ") : "A");
  const [surfaceProcess, setSurfaceProcess] = useState<"machined" | "unmachined" | "any">(annotation?.kind === "surface-texture" ? annotation.process ?? "machined" : "machined");
  const [weldType, setWeldType] = useState<"fillet" | "butt" | "groove" | "plug" | "spot">(annotation?.kind === "weld-symbol" ? annotation.weldType : "fillet");
  const [weldAllAround, setWeldAllAround] = useState(annotation?.kind === "weld-symbol" ? Boolean(annotation.allAround) : false);
  const [tolUpper, setTolUpper] = useState(annotation && "toleranceUpperMm" in annotation && annotation.toleranceUpperMm !== undefined ? String(annotation.toleranceUpperMm) : "");
  const [tolLower, setTolLower] = useState(annotation && "toleranceLowerMm" in annotation && annotation.toleranceLowerMm !== undefined ? String(annotation.toleranceLowerMm) : "");
  const [overrideText, setOverrideText] = useState(annotation && "overrideText" in annotation && annotation.overrideText ? annotation.overrideText : "");
  const [viewId, setViewId] = useState(annotation && "viewId" in annotation && annotation.viewId ? annotation.viewId : sheet.views[0]?.id ?? "");
  const [decimals, setDecimals] = useState(annotation && "decimals" in annotation ? annotation.decimals : 2);
  const [leader, setLeader] = useState<[number, number]>(
    annotation?.kind === "balloon" || annotation?.kind === "datum" || annotation?.kind === "weld-symbol" ? annotation.leaderMm
    : annotation?.kind === "leader-note" && annotation.leaderPointsMm[0] ? annotation.leaderPointsMm[0]
    : (annotation?.kind === "gdt" || annotation?.kind === "surface-texture") && annotation.leaderMm ? annotation.leaderMm
    : [sheet.widthMm / 2, sheet.heightMm / 2],
  );
  const attached = annotation && (annotation.kind === "diameter" || annotation.kind === "radius" || annotation.kind === "angle" || annotation.kind === "center-mark" || annotation.kind === "length" || annotation.kind === "hole-callout" || annotation.kind === "chamfer-note") ? annotation : undefined;
  const [atX, setAtX] = useState(attached?.atMm[0] ?? (annotation?.kind === "ordinate" ? annotation.datumMm[0] : annotation?.kind === "centerline" ? annotation.startMm[0] : sheet.widthMm / 2));
  const [atY, setAtY] = useState(attached?.atMm[1] ?? (annotation?.kind === "ordinate" ? annotation.datumMm[1] : annotation?.kind === "centerline" ? annotation.startMm[1] : sheet.heightMm / 2));
  const [toX, setToX] = useState(attached?.kind === "angle" ? attached.toMm[0] : annotation?.kind === "ordinate" ? annotation.targetMm[0] : annotation?.kind === "centerline" ? annotation.endMm[0] : sheet.widthMm / 2);
  const [toY, setToY] = useState(attached?.kind === "angle" ? attached.toMm[1] : annotation?.kind === "ordinate" ? annotation.targetMm[1] : annotation?.kind === "centerline" ? annotation.endMm[1] : sheet.heightMm / 2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const numberField = (id: string, label: string, value: number, change: (n: number) => void, unit?: string) => (
    <FieldRow label={label} htmlFor={`drawing-${id}`}>
      <NumberField
        id={`drawing-${id}`}
        disabled={busy}
        value={Number.isFinite(value) ? value : null}
        step={1}
        precision={3}
        unit={unit}
        onValueChange={(next) => change(next ?? NaN)}
      />
    </FieldRow>
  );

  const dimOverrides = () => {
    const up = tolUpper.trim() ? Number(tolUpper) : undefined;
    const lo = tolLower.trim() ? Number(tolLower) : undefined;
    const ov = overrideText.trim() || undefined;
    return {
      ...(up !== undefined && Number.isFinite(up) ? { toleranceUpperMm: up } : {}),
      ...(lo !== undefined && Number.isFinite(lo) ? { toleranceLowerMm: lo } : {}),
      ...(ov ? { overrideText: ov } : {}),
    };
  };

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const id = draft.editId ?? crypto.randomUUID();
      let command: DrawingCommand;
      if (draft.kind === "sheet") {
        const parsedRevs = parseRevisions(revisionsText);
        const revTable = showRevisionTable ? { originMm: [Math.max(15, width - 135), 15] as [number, number], widthMm: 120 } : null;
        command = draft.editId
          ? {
              type: "update-sheet", sheetId: id, name, widthMm: width, heightMm: height, projection,
              titleBlock: parseTitleBlock(titleBlock),
              ...(parsedRevs.length ? { revisions: parsedRevs } : sheet.revisions ? { revisions: null } : {}),
              ...(showRevisionTable ? { revisionTable: revTable } : sheet.revisionTable ? { revisionTable: null } : {}),
            }
          : {
              type: "add-sheet",
              sheet: {
                id, name, widthMm: width, heightMm: height, projection, views: [], annotations: [],
                ...(titleBlock.trim() ? { titleBlock: parseTitleBlock(titleBlock) } : {}),
                ...(parsedRevs.length ? { revisions: parsedRevs } : {}),
                ...(showRevisionTable && revTable ? { revisionTable: revTable } : {}),
              },
            };
      } else if (draft.kind === "view") {
        const standard = viewKind === "standard";
        const isFlat = viewKind === "flat-pattern";
        const changes: Omit<DrawingView, "id"> = {
          name, orientation: isFlat ? "top" : orientation, originMm: [x, y], scale, hiddenLines: hidden,
          section: standard && section ? { offsetMm: cutOffset, hatchSpacingMm: hatchSpacing } : null,
          parentId: standard && parentId ? parentId : undefined,
          ...(view?.bodyIds ? { bodyIds: view.bodyIds } : {}),
          direction: viewKind === "auxiliary" ? direction : null,
          detail: viewKind === "detail" ? { parentId: detailParent, centerMm: detailCenter, radiusMm: detailRadius, label: detailLabel } : null,
          ...(isFlat ? { flatPattern: true } : view?.flatPattern ? { flatPattern: false } : {}),
        };
        command = draft.editId ? { type: "update-view", sheetId: sheet.id, viewId: id, changes } : { type: "add-view", sheetId: sheet.id, view: { ...changes, id } };
      } else if (kind === "chain") {
        command = {
          type: "add-dimension-chain", sheetId: sheet.id,
          chain: { id, viewId, decimals, pointsMm: parsePointPicks(pointPicks), positionMm: [x, y], ...(pointAxis !== "aligned" ? { axis: pointAxis } : {}) },
        };
      } else {
        const ov = dimOverrides();
        const datumsList = gdtDatums.split(",").map((s) => s.trim()).filter(Boolean);
        const annotation: DrawingAnnotation = kind === "note" ? { id, kind, text, positionMm: [x, y] }
          : kind === "balloon" ? { id, kind, text, positionMm: [x, y], leaderMm: leader }
          : kind === "point-distance" || kind === "point-angle" ? {
              id, kind, viewId, decimals, positionMm: [x, y], pointsMm: parsePointPicks(pointPicks),
              ...(kind === "point-distance" && pointAxis !== "aligned" ? { axis: pointAxis } : {}), ...ov,
            }
          : kind === "center-mark" ? { id, kind, viewId, positionMm: [atX, atY], atMm: [atX, atY] }
          : kind === "angle" ? { id, kind, viewId, decimals, positionMm: [x, y], atMm: [atX, atY], toMm: [toX, toY], ...ov }
          : kind === "diameter" || kind === "radius" || kind === "length" ? { id, kind, viewId, decimals, positionMm: [x, y], atMm: [atX, atY], ...ov }
          : kind === "width" || kind === "height" ? { id, kind, viewId, decimals, positionMm: [x, y], ...ov }
          : kind === "revision-tag" ? { id, kind, revision: text || "A", positionMm: [x, y] }
          : kind === "datum" ? { id, kind, label: text || "A", leaderMm: leader, positionMm: [x, y], ...(viewId ? { viewId } : {}) }
          : kind === "gdt" ? { id, kind, characteristic: gdtChar, tolerance: text || "0.05", ...(datumsList.length ? { datums: datumsList } : {}), leaderMm: leader, positionMm: [x, y], ...(viewId ? { viewId } : {}) }
          : kind === "surface-texture" ? { id, kind, ra: text || "1.6", process: surfaceProcess, leaderMm: leader, positionMm: [x, y], ...(viewId ? { viewId } : {}) }
          : kind === "weld-symbol" ? { id, kind, weldType, ...(text.trim() ? { size: text.trim() } : {}), ...(weldAllAround ? { allAround: true } : {}), leaderMm: leader, positionMm: [x, y], ...(viewId ? { viewId } : {}) }
          : kind === "leader-note" ? { id, kind, text: text || "Note", leaderPointsMm: [leader], positionMm: [x, y], ...(viewId ? { viewId } : {}) }
          : kind === "centerline" ? { id, kind, viewId, startMm: [atX, atY], endMm: [toX, toY], positionMm: [x, y] }
          : kind === "ordinate" ? { id, kind, viewId, axis: pointAxis === "y" ? "y" : "x", datumMm: [atX, atY], targetMm: [toX, toY], decimals, positionMm: [x, y], ...ov }
          : kind === "hole-callout" ? { id, kind, viewId, atMm: [atX, atY], decimals, positionMm: [x, y], ...(text.trim() ? { text: text.trim() } : {}) }
          : { id, kind: "chamfer-note", viewId, atMm: [atX, atY], text: text || "1 x 45°", positionMm: [x, y] };
        command = { type: draft.editId ? "update-annotation" : "add-annotation", sheetId: sheet.id, annotation };
      }
      await execute(command);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = DRAWING_SHEET_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setWidth(tpl.widthMm);
    setHeight(tpl.heightMm);
    setProjection(tpl.projection);
    setTitleBlock(tpl.defaultTitleBlock.map((r) => `${r.label}: ${r.value}`).join("\n"));
  };

  const usesLeader = kind === "balloon" || kind === "leader-note" || kind === "datum" || kind === "gdt" || kind === "surface-texture" || kind === "weld-symbol";
  const usesView = kind !== "note" && kind !== "balloon" && kind !== "revision-tag";

  return (
    <Dialog
      open
      title={`${draft.editId ? "Edit" : "Add"} drawing ${draft.kind}`}
      onClose={() => { if (!busy) onClose(); }}
      actions={
        <>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button primary disabled={busy} onClick={() => void run()}>
            {busy ? "Rebuilding…" : draft.editId ? "Apply" : "Add"}
          </Button>
        </>
      }
    >
      <div className="cad-dialog-form cad-dialog-form--wide">
        {draft.kind === "sheet" ? (
          <>
            <div className="cad-dialog-section">
              <h4 className="cad-dialog-section-title">Sheet size &amp; standard</h4>
              <FieldRow label="Name" htmlFor="drawing-name">
                <TextField id="drawing-name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </FieldRow>
              <FieldRow label="ISO / ANSI template" htmlFor="drawing-template">
                <SelectField
                  id="drawing-template"
                  value={templateId}
                  disabled={busy}
                  options={[{ value: "", label: "Custom sheet" }, ...DRAWING_SHEET_TEMPLATES.map((t) => ({ value: t.id, label: t.name }))]}
                  onChange={(e) => applyTemplate(e.target.value)}
                />
              </FieldRow>
              <div className="cad-dialog-grid-2">
                {numberField("width", "Paper width (mm)", width, setWidth, "mm")}
                {numberField("height", "Paper height (mm)", height, setHeight, "mm")}
              </div>
              <FieldRow label="Projection" htmlFor="drawing-projection">
                <SelectField
                  id="drawing-projection"
                  value={projection}
                  disabled={busy}
                  options={[{ value: "third_angle", label: "Third angle (ANSI)" }, { value: "first_angle", label: "First angle (ISO)" }]}
                  onChange={(e) => setProjection(e.target.value as typeof projection)}
                />
              </FieldRow>
            </div>

            <div className="cad-dialog-section">
              <h4 className="cad-dialog-section-title">Title block &amp; revisions</h4>
              <FieldRow label="Title block" htmlFor="drawing-title-block" layout="stacked">
                <textarea
                  id="drawing-title-block"
                  className="cad-textarea"
                  rows={4}
                  disabled={busy}
                  value={titleBlock}
                  placeholder={"Drawn by: name\nMaterial: 6061-T6"}
                  onChange={(e) => setTitleBlock(e.target.value)}
                />
              </FieldRow>
              <FieldRow label="Revisions (Rev | Desc | Date | Author)" htmlFor="drawing-revisions" layout="stacked">
                <textarea
                  id="drawing-revisions"
                  className="cad-textarea"
                  rows={2}
                  disabled={busy}
                  value={revisionsText}
                  placeholder="A | Initial release | 2026-11-23 | J.J."
                  onChange={(e) => setRevisionsText(e.target.value)}
                />
              </FieldRow>
              <Checkbox label="Place revision table on sheet" checked={showRevisionTable} disabled={busy} onChange={(e) => setShowRevisionTable(e.target.checked)} />
            </div>
          </>
        ) : draft.kind === "view" ? (
          <>
            <div className="cad-dialog-section">
              <h4 className="cad-dialog-section-title">View configuration</h4>
              <FieldRow label="Name" htmlFor="drawing-name">
                <TextField id="drawing-name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </FieldRow>
              <FieldRow label="View type" htmlFor="drawing-view-kind">
                <SelectField
                  id="drawing-view-kind"
                  value={viewKind}
                  disabled={busy}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "auxiliary", label: "Auxiliary (custom direction)" },
                    { value: "detail", label: "Detail (enlarged circle)" },
                    { value: "flat-pattern", label: "Sheet metal flat pattern" },
                  ]}
                  onChange={(e) => {
                    setViewKind(e.target.value as typeof viewKind);
                    if (!view && e.target.value === "detail") setName(`Detail ${detailLabel}`);
                    if (!view && e.target.value === "flat-pattern") setName("Flat Pattern");
                  }}
                />
              </FieldRow>

              {viewKind === "auxiliary" && (
                <>
                  <div className="cad-dialog-grid-3">
                    {numberField("dir-x", "Dir X", direction[0], (n) => setDirection([n, direction[1], direction[2]]))}
                    {numberField("dir-y", "Dir Y", direction[1], (n) => setDirection([direction[0], n, direction[2]]))}
                    {numberField("dir-z", "Dir Z", direction[2], (n) => setDirection([direction[0], direction[1], n]))}
                  </div>
                  <p className="cad-form-note">Looks along the direction toward the viewer with world Z up on paper, e.g. the normal of an inclined face.</p>
                </>
              )}

              {viewKind === "detail" && (
                <>
                  <FieldRow label="Enlarges" htmlFor="drawing-detail-parent">
                    <SelectField
                      id="drawing-detail-parent"
                      value={detailParent}
                      disabled={busy}
                      options={sheet.views.filter((v) => !v.detail && v.id !== draft.editId).map((v) => ({ value: v.id, label: v.name }))}
                      onChange={(e) => setDetailParent(e.target.value)}
                    />
                  </FieldRow>
                  <div className="cad-dialog-grid-2">
                    {numberField("detail-cx", "Centre X (mm)", detailCenter[0], (n) => setDetailCenter([n, detailCenter[1]]), "mm")}
                    {numberField("detail-cy", "Centre Y (mm)", detailCenter[1], (n) => setDetailCenter([detailCenter[0], n]), "mm")}
                  </div>
                  <div className="cad-dialog-grid-2">
                    {numberField("detail-radius", "Radius (mm)", detailRadius, setDetailRadius, "mm")}
                    <FieldRow label="Marker letter" htmlFor="drawing-detail-label">
                      <TextField id="drawing-detail-label" value={detailLabel} disabled={busy} onChange={(e) => setDetailLabel(e.target.value)} />
                    </FieldRow>
                  </div>
                </>
              )}

              {viewKind === "standard" && (
                <>
                  <FieldRow label="Orientation" htmlFor="drawing-orientation">
                    <SelectField
                      id="drawing-orientation"
                      value={orientation}
                      disabled={busy}
                      options={drawingOrientations.filter((value) => !section || value !== "isometric").map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
                      onChange={(e) => {
                        setOrientation(e.target.value as typeof orientation);
                        if (!view) setName(e.target.value[0].toUpperCase() + e.target.value.slice(1));
                      }}
                    />
                  </FieldRow>
                  <FieldRow label="Projected from" htmlFor="drawing-parent">
                    <SelectField
                      id="drawing-parent"
                      value={parentId}
                      disabled={busy || section}
                      options={[
                        { value: "", label: "Independent base view" },
                        ...sheet.views.filter((v) => v.orientation === "front" && !v.section && !v.parentId && v.id !== draft.editId).map((v) => ({ value: v.id, label: v.name })),
                      ]}
                      onChange={(e) => setParent(e.target.value)}
                    />
                  </FieldRow>
                </>
              )}

              {viewKind === "standard" && parentId ? (
                <p className="cad-form-note">Projected views inherit their front view's scale and alignment. Choose top, bottom, left or right.</p>
              ) : (
                numberField("scale", "Scale ratio", scale, setScale)
              )}

              {viewKind === "standard" && (
                <Checkbox label="Section view" checked={section} disabled={busy || !!parentId || orientation === "isometric"} onChange={(e) => setSection(e.target.checked)} />
              )}
              {viewKind === "standard" && section && (
                <>
                  <div className="cad-dialog-grid-2">
                    {numberField("cut-offset", `Cut ${["top", "bottom"].includes(orientation) ? "Z" : ["left", "right"].includes(orientation) ? "X" : "Y"} (mm)`, cutOffset, setCutOffset, "mm")}
                    {numberField("hatch-spacing", "Hatch spacing (mm)", hatchSpacing, setHatchSpacing, "mm")}
                  </div>
                  <p className="cad-form-note">Removes material nearest the viewer. Choose a cut inside the solid; holes stay clear.</p>
                </>
              )}
              <Checkbox label="Show hidden edges / bend lines" checked={hidden} disabled={busy} onChange={(e) => setHidden(e.target.checked)} />
            </div>

            <div className="cad-dialog-section">
              <h4 className="cad-dialog-section-title">Sheet placement</h4>
              <div className="cad-dialog-grid-2">
                {numberField("x", "Sheet X (mm)", x, setX, "mm")}
                {numberField("y", "Sheet Y (mm)", y, setY, "mm")}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="cad-dialog-section">
              <h4 className="cad-dialog-section-title">Annotation type</h4>
              <FieldRow label="Annotation" htmlFor="drawing-annotation-kind">
                <SelectField
                  id="drawing-annotation-kind"
                  value={kind}
                  disabled={busy}
                  options={[
                    { value: "note", label: "Note" },
                    { value: "leader-note", label: "Leader note (supports {{part}}, {{rev}})" },
                    { value: "width", label: "Overall width dimension" },
                    { value: "height", label: "Overall height dimension" },
                    { value: "diameter", label: "Diameter dimension" },
                    { value: "radius", label: "Radius dimension" },
                    { value: "angle", label: "Angle dimension" },
                    { value: "length", label: "Edge length dimension" },
                    { value: "point-distance", label: "Point-to-point dimension" },
                    { value: "point-angle", label: "Three-point angle" },
                    { value: "ordinate", label: "Ordinate dimension" },
                    ...(!draft.editId ? [{ value: "chain", label: "Chain dimension" }] : []),
                    { value: "hole-callout", label: "Hole callout" },
                    { value: "chamfer-note", label: "Chamfer note" },
                    { value: "gdt", label: "GD&T feature control frame" },
                    { value: "datum", label: "Datum symbol" },
                    { value: "surface-texture", label: "Surface finish / roughness" },
                    { value: "weld-symbol", label: "Weld symbol" },
                    { value: "center-mark", label: "Centre mark" },
                    { value: "centerline", label: "Centerline" },
                    { value: "balloon", label: "Balloon" },
                    { value: "revision-tag", label: "Revision tag" },
                  ]}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                />
              </FieldRow>

              {usesView && (
                <FieldRow label="View" htmlFor="drawing-dimension-view">
                  <SelectField id="drawing-dimension-view" value={viewId} disabled={busy} options={sheet.views.map((v) => ({ value: v.id, label: v.name }))} onChange={(e) => setViewId(e.target.value)} />
                </FieldRow>
              )}

              {(kind === "note" || kind === "balloon" || kind === "leader-note" || kind === "chamfer-note" || kind === "hole-callout" || kind === "datum" || kind === "gdt" || kind === "surface-texture" || kind === "weld-symbol" || kind === "revision-tag") && (
                <FieldRow
                  label={kind === "datum" ? "Datum letter" : kind === "gdt" ? "Tolerance" : kind === "surface-texture" ? "Roughness Ra" : kind === "weld-symbol" ? "Weld size" : kind === "revision-tag" ? "Revision" : kind === "hole-callout" ? "Custom callout (optional)" : "Text"}
                  htmlFor="drawing-note"
                >
                  <TextField id="drawing-note" value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
                </FieldRow>
              )}

              {kind === "gdt" && (
                <>
                  <FieldRow label="Characteristic" htmlFor="drawing-gdt-char">
                    <SelectField
                      id="drawing-gdt-char"
                      value={gdtChar}
                      disabled={busy}
                      options={(Object.keys(gdtCharacteristicCodes) as GdtCharacteristic[]).map((c) => ({ value: c, label: `${c} (${gdtCharacteristicCodes[c]})` }))}
                      onChange={(e) => setGdtChar(e.target.value as GdtCharacteristic)}
                    />
                  </FieldRow>
                  <FieldRow label="Datums (comma-separated)" htmlFor="drawing-gdt-datums">
                    <TextField id="drawing-gdt-datums" value={gdtDatums} disabled={busy} onChange={(e) => setGdtDatums(e.target.value)} />
                  </FieldRow>
                </>
              )}

              {kind === "surface-texture" && (
                <FieldRow label="Process" htmlFor="drawing-surf-proc">
                  <SelectField
                    id="drawing-surf-proc"
                    value={surfaceProcess}
                    disabled={busy}
                    options={[
                      { value: "machined", label: "Machined (removal required)" },
                      { value: "unmachined", label: "Unmachined (removal prohibited)" },
                      { value: "any", label: "Any process" },
                    ]}
                    onChange={(e) => setSurfaceProcess(e.target.value as typeof surfaceProcess)}
                  />
                </FieldRow>
              )}

              {kind === "weld-symbol" && (
                <>
                  <FieldRow label="Weld type" htmlFor="drawing-weld-type">
                    <SelectField
                      id="drawing-weld-type"
                      value={weldType}
                      disabled={busy}
                      options={[
                        { value: "fillet", label: "Fillet" },
                        { value: "butt", label: "Butt" },
                        { value: "groove", label: "Groove" },
                        { value: "plug", label: "Plug" },
                        { value: "spot", label: "Spot" },
                      ]}
                      onChange={(e) => setWeldType(e.target.value as typeof weldType)}
                    />
                  </FieldRow>
                  <Checkbox label="All-around weld" checked={weldAllAround} disabled={busy} onChange={(e) => setWeldAllAround(e.target.checked)} />
                </>
              )}

              {(kind === "point-distance" || kind === "point-angle" || kind === "chain") && (
                <>
                  <FieldRow label={kind === "point-angle" ? "Points: endpoint, vertex, endpoint (mm)" : kind === "chain" ? "Ordered points (mm)" : "Two points (mm)"} htmlFor="drawing-point-picks" layout="stacked">
                    <textarea id="drawing-point-picks" className="cad-textarea" rows={3} value={pointPicks} disabled={busy} onChange={(event) => setPointPicks(event.target.value)} placeholder="X, Y — one point per line" />
                  </FieldRow>
                  {(kind === "point-distance" || kind === "chain") && (
                    <FieldRow label="Direction" htmlFor="drawing-point-axis">
                      <SelectField
                        id="drawing-point-axis"
                        value={pointAxis}
                        disabled={busy}
                        options={[{ value: "aligned", label: "Aligned" }, { value: "x", label: "Horizontal" }, { value: "y", label: "Vertical" }]}
                        onChange={(event) => setPointAxis(event.target.value as typeof pointAxis)}
                      />
                    </FieldRow>
                  )}
                </>
              )}

              {kind === "ordinate" && (
                <FieldRow label="Axis" htmlFor="drawing-ord-axis">
                  <SelectField id="drawing-ord-axis" value={pointAxis === "y" ? "y" : "x"} disabled={busy} options={[{ value: "x", label: "X ordinate" }, { value: "y", label: "Y ordinate" }]} onChange={(e) => setPointAxis(e.target.value as "x" | "y")} />
                </FieldRow>
              )}

              {(DIMENSION_KINDS.has(kind) || kind === "chain" || kind === "hole-callout") && numberField("decimals", "Decimal places", decimals, setDecimals)}
            </div>

            <div className="cad-dialog-section">
              <h4 className="cad-dialog-section-title">References &amp; sheet position</h4>
              {usesLeader && (
                <div className="cad-dialog-grid-2">
                  {numberField("leader-x", "Leader tip X (mm)", leader[0], (n) => setLeader([n, leader[1]]), "mm")}
                  {numberField("leader-y", "Leader tip Y (mm)", leader[1], (n) => setLeader([leader[0], n]), "mm")}
                </div>
              )}

              {(kind === "diameter" || kind === "radius" || kind === "angle" || kind === "center-mark" || kind === "length" || kind === "hole-callout" || kind === "chamfer-note" || kind === "ordinate" || kind === "centerline") && (
                <>
                  <div className="cad-dialog-grid-2">
                    {numberField("at-x", kind === "ordinate" ? "Datum X (mm)" : kind === "centerline" ? "Start X (mm)" : kind === "angle" ? "First edge X (mm)" : "Pick X (mm)", atX, setAtX, "mm")}
                    {numberField("at-y", kind === "ordinate" ? "Datum Y (mm)" : kind === "centerline" ? "Start Y (mm)" : kind === "angle" ? "First edge Y (mm)" : "Pick Y (mm)", atY, setAtY, "mm")}
                  </div>
                  {(kind === "angle" || kind === "ordinate" || kind === "centerline") && (
                    <div className="cad-dialog-grid-2">
                      {numberField("to-x", kind === "ordinate" ? "Target X (mm)" : kind === "centerline" ? "End X (mm)" : "Second edge X (mm)", toX, setToX, "mm")}
                      {numberField("to-y", kind === "ordinate" ? "Target Y (mm)" : kind === "centerline" ? "End Y (mm)" : "Second edge Y (mm)", toY, setToY, "mm")}
                    </div>
                  )}
                </>
              )}

              {kind !== "center-mark" && (
                <div className="cad-dialog-grid-2">
                  {numberField("x", "Sheet X (mm)", x, setX, "mm")}
                  {numberField("y", "Sheet Y (mm)", y, setY, "mm")}
                </div>
              )}
            </div>

            {DIMENSION_KINDS.has(kind) && (
              <div className="cad-dialog-section">
                <h4 className="cad-dialog-section-title">Tolerances &amp; override</h4>
                <div className="cad-dialog-grid-2">
                  <FieldRow label="Upper (+mm)" htmlFor="drawing-tol-up">
                    <TextField id="drawing-tol-up" value={tolUpper} disabled={busy} placeholder="0.1" onChange={(e) => setTolUpper(e.target.value)} />
                  </FieldRow>
                  <FieldRow label="Lower (-mm)" htmlFor="drawing-tol-lo">
                    <TextField id="drawing-tol-lo" value={tolLower} disabled={busy} placeholder="-0.1" onChange={(e) => setTolLower(e.target.value)} />
                  </FieldRow>
                </div>
                <FieldRow label="Override ({value} = measured)" htmlFor="drawing-override-text">
                  <TextField id="drawing-override-text" value={overrideText} disabled={busy} placeholder="{value} REF" onChange={(e) => setOverrideText(e.target.value)} />
                </FieldRow>
              </div>
            )}
          </>
        )}
        {error && <p className="cad-dialog-alert" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

function parsePointPicks(value: string): [number, number][] {
  return value.trim().split("\n").map((line) => {
    const fields = line.split(","), coordinates = fields.map((value) => Number(value.trim()));
    if (fields.length !== 2 || fields.some((value) => !value.trim()) || coordinates.some((value) => !Number.isFinite(value))) throw Error("Enter one X, Y point per line.");
    return coordinates as [number, number];
  });
}
