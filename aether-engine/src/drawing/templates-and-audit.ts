import { applyDrawingCommand, createDrawingDocument, type DrawingAnnotation, type DrawingDocument, type DrawingPoint, type DrawingSheet } from "./document";
import type { PartDocument } from "../document/part-document";
import type { BuiltDrawing, BuiltDrawingView } from "./build";
import { sheetPoint } from "./build";
import { extractProjectionSnapPoints } from "./standards-annotations";

/** Standard ISO & ANSI engineering sheet templates (`drawing.template.list/apply`). */
export interface DrawingSheetTemplate {
  id: string;
  name: string;
  standard: "ISO" | "ANSI";
  widthMm: number;
  heightMm: number;
  projection: "first_angle" | "third_angle";
  defaultTitleBlock: { label: string; value: string }[];
}

export const DRAWING_SHEET_TEMPLATES: readonly DrawingSheetTemplate[] = [
  { id: "iso-a4", name: "ISO A4 Landscape", standard: "ISO", widthMm: 297, heightMm: 210, projection: "first_angle", defaultTitleBlock: [{ label: "Drawing No.", value: "DWG-001" }, { label: "Rev", value: "A" }, { label: "Scale", value: "1:1" }, { label: "Material", value: "" }] },
  { id: "iso-a3", name: "ISO A3 Landscape", standard: "ISO", widthMm: 420, heightMm: 297, projection: "first_angle", defaultTitleBlock: [{ label: "Drawing No.", value: "DWG-001" }, { label: "Rev", value: "A" }, { label: "Scale", value: "1:1" }, { label: "Material", value: "" }] },
  { id: "iso-a2", name: "ISO A2 Landscape", standard: "ISO", widthMm: 594, heightMm: 420, projection: "first_angle", defaultTitleBlock: [{ label: "Drawing No.", value: "DWG-001" }, { label: "Rev", value: "A" }, { label: "Scale", value: "1:1" }, { label: "Material", value: "" }] },
  { id: "iso-a1", name: "ISO A1 Landscape", standard: "ISO", widthMm: 841, heightMm: 594, projection: "first_angle", defaultTitleBlock: [{ label: "Drawing No.", value: "DWG-001" }, { label: "Rev", value: "A" }, { label: "Scale", value: "1:1" }, { label: "Material", value: "" }] },
  { id: "ansi-a", name: "ANSI A Landscape (11×8.5 in)", standard: "ANSI", widthMm: 279.4, heightMm: 215.9, projection: "third_angle", defaultTitleBlock: [{ label: "DWG NO", value: "DWG-001" }, { label: "REV", value: "A" }, { label: "SCALE", value: "1:1" }, { label: "MATERIAL", value: "" }] },
  { id: "ansi-b", name: "ANSI B Landscape (17×11 in)", standard: "ANSI", widthMm: 431.8, heightMm: 279.4, projection: "third_angle", defaultTitleBlock: [{ label: "DWG NO", value: "DWG-001" }, { label: "REV", value: "A" }, { label: "SCALE", value: "1:1" }, { label: "MATERIAL", value: "" }] },
  { id: "ansi-c", name: "ANSI C Landscape (22×17 in)", standard: "ANSI", widthMm: 558.8, heightMm: 431.8, projection: "third_angle", defaultTitleBlock: [{ label: "DWG NO", value: "DWG-001" }, { label: "REV", value: "A" }, { label: "Scale", value: "1:1" }, { label: "MATERIAL", value: "" }] },
] as const;

export function applyDrawingTemplate(doc: DrawingDocument, sheetId: string, templateId: string): DrawingDocument {
  const tpl = DRAWING_SHEET_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error(`Unknown drawing template "${templateId}".`);
  return applyDrawingCommand(doc, {
    type: "update-sheet",
    sheetId,
    widthMm: tpl.widthMm,
    heightMm: tpl.heightMm,
    projection: tpl.projection,
    titleBlock: structuredClone(tpl.defaultTitleBlock),
  });
}

/** Create a standard 4-view drawing (Front base, Top & Right projected, Isometric) from a template (`drawing.view.standard`). */
export function createStandardDrawing(source: PartDocument, templateId = "iso-a3", scale = 1): DrawingDocument {
  let doc = createDrawingDocument(source);
  const sheetId = doc.activeSheetId;
  doc = applyDrawingTemplate(doc, sheetId, templateId);
  const sheet = doc.sheets[0];
  const cx = sheet.widthMm * 0.32, cy = sheet.heightMm * 0.62;
  const dx = sheet.widthMm * 0.28, dy = sheet.heightMm * 0.28;
  doc = applyDrawingCommand(doc, { type: "add-view", sheetId, view: { id: "view-front", name: "Front", orientation: "front", originMm: [cx, cy], scale, hiddenLines: true } });
  doc = applyDrawingCommand(doc, { type: "add-view", sheetId, view: { id: "view-top", name: "Top", orientation: "top", parentId: "view-front", originMm: [cx, cy - dy], scale, hiddenLines: true } });
  doc = applyDrawingCommand(doc, { type: "add-view", sheetId, view: { id: "view-right", name: "Right", orientation: "right", parentId: "view-front", originMm: [cx + dx, cy], scale, hiddenLines: true } });
  doc = applyDrawingCommand(doc, { type: "add-view", sheetId, view: { id: "view-iso", name: "Isometric", orientation: "isometric", originMm: [cx + dx, cy - dy], scale: scale * 0.85, hiddenLines: false } });
  return doc;
}

/** Import overall & primary model dimensions onto a view (`drawing.dimension.from_model`). */
export function importModelDimensions(doc: DrawingDocument, sheetId: string, viewId: string): DrawingDocument {
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error("Drawing sheet does not exist.");
  const view = sheet.views.find((v) => v.id === viewId);
  if (!view) throw new Error("Drawing view does not exist.");
  let next = doc;
  const existingIds = new Set(sheet.annotations.map((a) => a.id));
  const uniqueId = (base: string) => { let id = base, n = 1; while (existingIds.has(id)) id = `${base}-${n++}`; existingIds.add(id); return id; };
  if (!sheet.annotations.some((a) => a.kind === "width" && a.viewId === viewId)) {
    next = applyDrawingCommand(next, {
      type: "add-annotation",
      sheetId,
      annotation: { id: uniqueId(`${viewId}-width`), kind: "width", viewId, decimals: 2, positionMm: [view.originMm[0], view.originMm[1] - 32] },
    });
  }
  if (!sheet.annotations.some((a) => a.kind === "height" && a.viewId === viewId)) {
    next = applyDrawingCommand(next, {
      type: "add-annotation",
      sheetId,
      annotation: { id: uniqueId(`${viewId}-height`), kind: "height", viewId, decimals: 2, positionMm: [view.originMm[0] - 42, view.originMm[1]] },
    });
  }
  return next;
}

export interface DrawingHitResult {
  kind: "view" | "annotation" | "snap";
  id: string;
  viewId?: string;
  pointMm: DrawingPoint;
  distanceMm: number;
}

/** Hit-test what is under a sheet-mm cursor position (`drawing.scene.hit`). */
export function drawingHitTest(
  built: BuiltDrawing,
  sheetId: string,
  pointMm: DrawingPoint,
  radiusMm = 5,
): DrawingHitResult[] {
  const sheetBuilt = built.sheets.find((s) => s.sheet.id === sheetId);
  if (!sheetBuilt) throw new Error("Drawing sheet does not exist.");
  const hits: DrawingHitResult[] = [];

  for (const view of sheetBuilt.views) {
    for (const snap of extractProjectionSnapPoints(view)) {
      const d = Math.hypot(snap.pointMm[0] - pointMm[0], snap.pointMm[1] - pointMm[1]);
      if (d <= radiusMm) hits.push({ kind: "snap", id: snap.id, viewId: view.view.id, pointMm: snap.pointMm, distanceMm: d });
    }
    const [x0, y0, x1, y1] = view.boundsMm;
    if (pointMm[0] >= x0 - radiusMm && pointMm[0] <= x1 + radiusMm && pointMm[1] >= y0 - radiusMm && pointMm[1] <= y1 + radiusMm) {
      hits.push({ kind: "view", id: view.view.id, viewId: view.view.id, pointMm: view.view.originMm, distanceMm: 0 });
    }
  }
  for (const ann of sheetBuilt.annotations) {
    let best = Math.hypot(ann.positionMm[0] - pointMm[0], ann.positionMm[1] - pointMm[1]);
    for (const [a, b] of ann.lines) {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((pointMm[0] - a[0]) * dx + (pointMm[1] - a[1]) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(pointMm[0] - (a[0] + t * dx), pointMm[1] - (a[1] + t * dy)));
    }
    if (best <= radiusMm) hits.push({ kind: "annotation", id: ann.id, viewId: ann.viewId, pointMm: ann.positionMm, distanceMm: best });
  }
  hits.sort((a, b) => a.distanceMm - b.distanceMm);
  return hits;
}

/** Find the nearest projected visible curve under a sheet-mm point (`drawing.scene.line`). */
export function drawingLineAt(
  built: BuiltDrawing,
  sheetId: string,
  pointMm: DrawingPoint,
  radiusMm = 5,
): { viewId: string; curveIndex: number; kind: string; distanceMm: number } | null {
  const sheetBuilt = built.sheets.find((s) => s.sheet.id === sheetId);
  if (!sheetBuilt) throw new Error("Drawing sheet does not exist.");
  let best: { viewId: string; curveIndex: number; kind: string; distanceMm: number } | null = null;
  for (const view of sheetBuilt.views) {
    view.geometry.visible.forEach((curve, idx) => {
      let d = Infinity;
      if (curve.kind === "line") {
        const a = sheetPoint(view, curve.start), b = sheetPoint(view, curve.end);
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((pointMm[0] - a[0]) * dx + (pointMm[1] - a[1]) * dy) / l2)) : 0;
        d = Math.hypot(pointMm[0] - (a[0] + t * dx), pointMm[1] - (a[1] + t * dy));
      } else if (curve.kind === "circle" || curve.kind === "arc") {
        const c = sheetPoint(view, curve.center);
        d = Math.abs(Math.hypot(pointMm[0] - c[0], pointMm[1] - c[1]) - curve.radius * view.view.scale);
      }
      if (d <= radiusMm && (!best || d < best.distanceMm)) {
        best = { viewId: view.view.id, curveIndex: idx, kind: curve.kind, distanceMm: d };
      }
    });
  }
  return best;
}

export interface DrawingAuditFinding {
  severity: "error" | "warning" | "info";
  code: string;
  sheetId: string;
  entityId?: string;
  message: string;
}

/** Comprehensive drawing quality audit (`drawing.check`): detects off-sheet views/annotations,
 *  overlapping view boxes, dangling attachments, empty title block fields, and undimensioned views. */
export function auditDrawing(built: BuiltDrawing): { ok: boolean; findings: DrawingAuditFinding[] } {
  const findings: DrawingAuditFinding[] = [];
  for (const sb of built.sheets) {
    const { sheet, views, annotations } = sb;
    const minX = 10, minY = 10, maxX = sheet.widthMm - 10, maxY = sheet.heightMm - 10;

    for (const v of views) {
      const [x0, y0, x1, y1] = v.boundsMm;
      if (x0 < minX || y0 < minY || x1 > maxX || y1 > maxY) {
        findings.push({ severity: "warning", code: "view_off_sheet", sheetId: sheet.id, entityId: v.view.id, message: `View "${v.view.name}" extends outside the sheet border.` });
      }
      const hasDim = annotations.some((a) => a.viewId === v.view.id && a.measure !== undefined);
      if (!hasDim && v.view.orientation !== "isometric") {
        findings.push({ severity: "info", code: "view_undimensioned", sheetId: sheet.id, entityId: v.view.id, message: `Orthographic view "${v.view.name}" has no dimensions.` });
      }
    }
    for (let i = 0; i < views.length; i++) {
      for (let j = i + 1; j < views.length; j++) {
        const a = views[i].boundsMm, b = views[j].boundsMm;
        if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) {
          findings.push({ severity: "warning", code: "views_overlap", sheetId: sheet.id, entityId: views[i].view.id, message: `Views "${views[i].view.name}" and "${views[j].view.name}" overlap.` });
        }
      }
    }
    for (const a of annotations) {
      if (a.dangling) {
        findings.push({ severity: "error", code: "dangling_annotation", sheetId: sheet.id, entityId: a.id, message: `Annotation "${a.id}" lost its model attachment and needs repair.` });
      }
      const [px, py] = a.positionMm;
      if (px < minX || py < minY || px > maxX || py > maxY) {
        findings.push({ severity: "warning", code: "annotation_off_sheet", sheetId: sheet.id, entityId: a.id, message: `Annotation "${a.id}" lies outside the sheet border.` });
      }
    }
    for (const row of sheet.titleBlock ?? []) {
      if (!row.value.trim()) {
        findings.push({ severity: "info", code: "empty_title_field", sheetId: sheet.id, message: `Title block field "${row.label}" is blank.` });
      }
    }
  }
  return { ok: !findings.some((f) => f.severity === "error"), findings };
}

/** Repair an attached dimension or callout by moving its attachment pick point (`drawing.dimension.repair`). */
export function repairDrawingAnnotation(
  doc: DrawingDocument,
  sheetId: string,
  annotationId: string,
  rebind: { atMm?: DrawingPoint; toMm?: DrawingPoint; pointsMm?: DrawingPoint[] },
): DrawingDocument {
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error("Drawing sheet does not exist.");
  const existing = sheet.annotations.find((a) => a.id === annotationId);
  if (!existing) throw new Error("Drawing annotation does not exist.");
  const updated = { ...existing, ...rebind } as DrawingAnnotation;
  return applyDrawingCommand(doc, { type: "update-annotation", sheetId, annotation: updated });
}

export function reorderDrawingSheets(doc: DrawingDocument, sheetIds: string[]): DrawingDocument {
  if (sheetIds.length !== doc.sheets.length || new Set(sheetIds).size !== sheetIds.length)
    throw new Error("Provide every existing sheet ID once to reorder sheets.");
  const byId = new Map(doc.sheets.map((s) => [s.id, s]));
  const reordered = sheetIds.map((id) => {
    const found = byId.get(id);
    if (!found) throw new Error(`Unknown sheet ID "${id}".`);
    return structuredClone(found);
  });
  return { ...structuredClone(doc), sheets: reordered };
}

export function revisionTableGrid(
  revisions: NonNullable<DrawingSheet["revisions"]>,
  originMm: DrawingPoint,
  widthMm = 120,
): { lines: [number, number, number, number][]; texts: { x: number; y: number; text: string; bold: boolean }[] } {
  const columns = ["Rev", "Description", "Date", "Author"];
  const [x, y] = originMm;
  const rows = revisions.length + 1;
  const h = 5 * rows;
  const colWidths = [widthMm * 0.14, widthMm * 0.48, widthMm * 0.2, widthMm * 0.18];
  const lines: [number, number, number, number][] = [
    [x, y, x + widthMm, y],
    [x + widthMm, y, x + widthMm, y + h],
    [x + widthMm, y + h, x, y + h],
    [x, y + h, x, y],
  ];
  for (let r = 1; r < rows; r++) lines.push([x, y + 5 * r, x + widthMm, y + 5 * r]);
  let cx = x;
  const colX = [x];
  for (let c = 0; c < columns.length - 1; c++) {
    cx += colWidths[c];
    colX.push(cx);
    lines.push([cx, y, cx, y + h]);
  }
  const texts: { x: number; y: number; text: string; bold: boolean }[] = columns.map((label, c) => ({
    x: colX[c] + 1,
    y: y + 3.6,
    text: label,
    bold: true,
  }));
  revisions.forEach((rev, r) => {
    const vals = [rev.rev, rev.description, rev.date, rev.author ?? ""];
    vals.forEach((val, c) => texts.push({ x: colX[c] + 1, y: y + 5 * (r + 1) + 3.6, text: val, bold: false }));
  });
  return { lines, texts };
}

export function sheetViewSnapPoints(view: BuiltDrawingView) {
  return extractProjectionSnapPoints(view);
}
