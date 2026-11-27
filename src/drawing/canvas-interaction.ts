/** Interactive 2D Drawing canvas geometry, magnetic snapping, pan/zoom viewBox math,
 *  and canonical command builders for drag-to-move and click-to-place authoring. */
import type {
  DrawingAnnotation,
  DrawingCommand,
  DrawingDocument,
  DrawingPoint,
  DrawingSheet,
  DrawingView,
} from "@aether/core/drawing";
import type { DrawingSheetProjection, DrawingSnapPoint } from "../core/cad-drawing-bridge";

export type DrawingPlacementTool =
  | "select"
  | "point-distance"
  | "ordinate"
  | "centerline"
  | "note"
  | "leader-note"
  | "hole-callout"
  | "chamfer-note"
  | "datum"
  | "gdt"
  | "surface-texture"
  | "weld-symbol"
  | "revision-tag";

export interface DrawingPlacementToolMeta {
  readonly id: DrawingPlacementTool;
  readonly label: string;
  readonly clicks: 0 | 1 | 2;
  readonly hint: string;
}

export const DRAWING_PLACEMENT_TOOLS: readonly DrawingPlacementToolMeta[] = [
  { id: "select", label: "Select / Drag", clicks: 0, hint: "Click to select, drag views or annotations to reposition, scroll to zoom, Shift+drag to pan." },
  { id: "point-distance", label: "Distance", clicks: 2, hint: "Click two snapped points to place an aligned linear dimension." },
  { id: "ordinate", label: "Ordinate", clicks: 2, hint: "Click datum origin, then target point to place an ordinate dimension." },
  { id: "centerline", label: "Centerline", clicks: 2, hint: "Click start and end points to place a centerline." },
  { id: "note", label: "Note", clicks: 1, hint: "Click on the sheet to place a text note." },
  { id: "leader-note", label: "Leader", clicks: 1, hint: "Click a feature point to attach a leader callout note." },
  { id: "hole-callout", label: "Hole", clicks: 1, hint: "Click a hole circle or center to attach a hole callout." },
  { id: "chamfer-note", label: "Chamfer", clicks: 1, hint: "Click a chamfer edge to attach a chamfer note." },
  { id: "datum", label: "Datum", clicks: 1, hint: "Click an edge or point to attach a datum symbol." },
  { id: "gdt", label: "GD&T", clicks: 1, hint: "Click a feature to attach a GD&T feature control frame." },
  { id: "surface-texture", label: "Surface", clicks: 1, hint: "Click a surface edge to attach a surface roughness symbol." },
  { id: "weld-symbol", label: "Weld", clicks: 1, hint: "Click a joint edge to attach a weld symbol." },
  { id: "revision-tag", label: "Rev Tag", clicks: 1, hint: "Click on the sheet to place a revision triangle tag." },
] as const;

export type SheetViewBox = readonly [x: number, y: number, width: number, height: number];

export function defaultViewBox(sheetWidthMm: number, sheetHeightMm: number): SheetViewBox {
  return [0, 0, sheetWidthMm, sheetHeightMm];
}

export function clampViewBox(vb: SheetViewBox, sheetWidthMm: number, sheetHeightMm: number): SheetViewBox {
  const minW = Math.max(20, sheetWidthMm / 12);
  const maxW = sheetWidthMm * 2.5;
  const w = Math.max(minW, Math.min(maxW, vb[2]));
  const h = w * (sheetHeightMm / Math.max(1, sheetWidthMm));
  const padX = sheetWidthMm * 0.5;
  const padY = sheetHeightMm * 0.5;
  const x = Math.max(-padX, Math.min(sheetWidthMm + padX - w, vb[0]));
  const y = Math.max(-padY, Math.min(sheetHeightMm + padY - h, vb[1]));
  return [x, y, w, h];
}

export function zoomViewBoxAt(
  vb: SheetViewBox,
  sheetWidthMm: number,
  sheetHeightMm: number,
  scaleFactor: number,
  anchorMm: DrawingPoint,
): SheetViewBox {
  const nextW = vb[2] / scaleFactor;
  const nextH = nextW * (sheetHeightMm / Math.max(1, sheetWidthMm));
  const clamped = clampViewBox([vb[0], vb[1], nextW, nextH], sheetWidthMm, sheetHeightMm);
  const rx = (anchorMm[0] - vb[0]) / Math.max(1e-6, vb[2]);
  const ry = (anchorMm[1] - vb[1]) / Math.max(1e-6, vb[3]);
  return clampViewBox(
    [anchorMm[0] - rx * clamped[2], anchorMm[1] - ry * clamped[3], clamped[2], clamped[3]],
    sheetWidthMm,
    sheetHeightMm,
  );
}

/** Convert client pointer coordinates into exact sheet-space millimeters using the live SVG rect and viewBox. */
export function clientToSheetMm(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  vb: SheetViewBox,
): DrawingPoint {
  const u = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const v = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return [vb[0] + u * vb[2], vb[1] + v * vb[3]];
}

export interface SnapCandidate {
  readonly snap: DrawingSnapPoint;
  readonly viewId: string;
  readonly distanceMm: number;
}

/** Magnetic snap lookup across all views on the displayed sheet projection. */
export function findNearestSnapPoint(
  sheet: DrawingSheetProjection,
  pointMm: DrawingPoint,
  radiusMm = 4.5,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const view of sheet.views) {
    if (view.state === "suppressed") continue;
    for (const snap of view.geometry.snap_points) {
      const d = Math.hypot(snap.point_sheet_mm[0] - pointMm[0], snap.point_sheet_mm[1] - pointMm[1]);
      if (d <= radiusMm && (!best || d < best.distanceMm)) {
        best = { snap, viewId: view.id, distanceMm: d };
      }
    }
  }
  return best;
}

/** Find the view containing `pointMm` (or nearest to it) on a canonical DrawingSheet. */
export function resolveTargetViewId(
  sheetProj: DrawingSheetProjection,
  pointMm: DrawingPoint,
  snappedViewId?: string,
): string | undefined {
  if (snappedViewId) return snappedViewId;
  for (const v of sheetProj.views) {
    const [x0, y0, x1, y1] = v.boundary_sheet_mm;
    if (pointMm[0] >= x0 - 4 && pointMm[0] <= x1 + 4 && pointMm[1] >= y0 - 4 && pointMm[1] <= y1 + 4) {
      return v.id;
    }
  }
  let nearest: { id: string; dist: number } | null = null;
  for (const v of sheetProj.views) {
    const d = Math.hypot(v.origin_sheet_mm[0] - pointMm[0], v.origin_sheet_mm[1] - pointMm[1]);
    if (!nearest || d < nearest.dist) nearest = { id: v.id, dist: d };
  }
  return nearest?.id;
}

const roundMm = (n: number) => Math.round(n * 100) / 100;
const shiftPt = (p: DrawingPoint, delta: DrawingPoint): DrawingPoint => [roundMm(p[0] + delta[0]), roundMm(p[1] + delta[1])];

/** Build canonical `update-view` command translating a view origin on the sheet. */
export function buildMoveViewCommand(
  sheetId: string,
  view: DrawingView,
  deltaMm: DrawingPoint,
): DrawingCommand {
  return {
    type: "update-view",
    sheetId,
    viewId: view.id,
    changes: {
      originMm: shiftPt(view.originMm, deltaMm),
    },
  };
}

/** Build canonical `update-annotation` command repositioning an annotation label/body while keeping
 *  geometry attachments (`atMm`, `toMm`, `pointsMm`, `leaderMm`) anchored cleanly. */
export function buildMoveAnnotationCommand(
  sheetId: string,
  annotation: DrawingAnnotation,
  deltaMm: DrawingPoint,
): DrawingCommand {
  return {
    type: "update-annotation",
    sheetId,
    annotation: {
      ...annotation,
      positionMm: shiftPt(annotation.positionMm, deltaMm),
    },
  };
}

function uniqueAnnotationId(sheet: DrawingSheet, prefix: string): string {
  const used = new Set(sheet.annotations.map((a) => a.id));
  let idx = sheet.annotations.length + 1;
  let id = `${prefix}-${idx}`;
  while (used.has(id)) {
    idx += 1;
    id = `${prefix}-${idx}`;
  }
  return id;
}

/** Build a canonical Format-v6 `add-annotation` command from 1 or 2 snapped sheet points. */
export function buildPlacementCommand(
  doc: DrawingDocument,
  sheetProj: DrawingSheetProjection,
  tool: Exclude<DrawingPlacementTool, "select">,
  pointsMm: readonly DrawingPoint[],
  snappedViewId?: string,
): DrawingCommand {
  const sheet = doc.sheets.find((s) => s.id === sheetProj.id);
  if (!sheet) throw new Error("Active drawing sheet does not exist.");
  const p0 = pointsMm[0];
  if (!p0) throw new Error("Click a point on the drawing sheet.");
  const p1 = pointsMm[1] ?? p0;
  const viewId = resolveTargetViewId(sheetProj, p0, snappedViewId);
  const offsetPos: DrawingPoint = [roundMm(p0[0] + 14), roundMm(Math.max(12, p0[1] - 12))];
  const id = uniqueAnnotationId(sheet, tool);

  let annotation: DrawingAnnotation;
  switch (tool) {
    case "note":
      annotation = { id, kind: "note", text: "NOTE", positionMm: [roundMm(p0[0]), roundMm(p0[1])] };
      break;
    case "leader-note":
      annotation = {
        id,
        kind: "leader-note",
        ...(viewId ? { viewId } : {}),
        text: "CALLOUT",
        leaderPointsMm: [[roundMm(p0[0]), roundMm(p0[1])]],
        positionMm: offsetPos,
      };
      break;
    case "datum": {
      const existingDatums = sheet.annotations.filter((a) => a.kind === "datum").length;
      const label = String.fromCharCode(65 + (existingDatums % 26));
      annotation = {
        id,
        kind: "datum",
        ...(viewId ? { viewId } : {}),
        label,
        leaderMm: [roundMm(p0[0]), roundMm(p0[1])],
        positionMm: offsetPos,
      };
      break;
    }
    case "gdt":
      annotation = {
        id,
        kind: "gdt",
        ...(viewId ? { viewId } : {}),
        characteristic: "position",
        tolerance: "Ø0.10",
        datums: ["A"],
        leaderMm: [roundMm(p0[0]), roundMm(p0[1])],
        positionMm: offsetPos,
      };
      break;
    case "surface-texture":
      annotation = {
        id,
        kind: "surface-texture",
        ...(viewId ? { viewId } : {}),
        ra: "Ra 1.6",
        process: "machined",
        leaderMm: [roundMm(p0[0]), roundMm(p0[1])],
        positionMm: offsetPos,
      };
      break;
    case "weld-symbol":
      annotation = {
        id,
        kind: "weld-symbol",
        ...(viewId ? { viewId } : {}),
        weldType: "fillet",
        size: "3",
        leaderMm: [roundMm(p0[0]), roundMm(p0[1])],
        positionMm: offsetPos,
      };
      break;
    case "revision-tag": {
      const rev = sheet.revisions?.at(-1)?.rev ?? "A";
      annotation = { id, kind: "revision-tag", revision: rev, positionMm: [roundMm(p0[0]), roundMm(p0[1])] };
      break;
    }
    case "hole-callout":
      if (!viewId) throw new Error("Add a drawing view before placing a hole callout.");
      annotation = { id, kind: "hole-callout", viewId, atMm: [roundMm(p0[0]), roundMm(p0[1])], positionMm: offsetPos, decimals: 2 };
      break;
    case "chamfer-note":
      if (!viewId) throw new Error("Add a drawing view before placing a chamfer note.");
      annotation = { id, kind: "chamfer-note", viewId, atMm: [roundMm(p0[0]), roundMm(p0[1])], text: "1 × 45°", positionMm: offsetPos };
      break;
    case "point-distance": {
      if (!viewId) throw new Error("Add a drawing view before placing a linear dimension.");
      const mid: DrawingPoint = [roundMm((p0[0] + p1[0]) / 2), roundMm(Math.min(p0[1], p1[1]) - 10)];
      annotation = {
        id,
        kind: "point-distance",
        viewId,
        pointsMm: [[roundMm(p0[0]), roundMm(p0[1])], [roundMm(p1[0]), roundMm(p1[1])]],
        decimals: 2,
        positionMm: mid,
      };
      break;
    }
    case "ordinate":
      if (!viewId) throw new Error("Add a drawing view before placing an ordinate dimension.");
      annotation = {
        id,
        kind: "ordinate",
        viewId,
        datumMm: [roundMm(p0[0]), roundMm(p0[1])],
        targetMm: [roundMm(p1[0]), roundMm(p1[1])],
        axis: Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]) ? "x" : "y",
        decimals: 2,
        positionMm: [roundMm(p1[0]), roundMm(Math.max(12, p1[1] - 12))],
      };
      break;
    case "centerline":
      if (!viewId) throw new Error("Add a drawing view before placing a centerline.");
      annotation = {
        id,
        kind: "centerline",
        viewId,
        startMm: [roundMm(p0[0]), roundMm(p0[1])],
        endMm: [roundMm(p1[0]), roundMm(p1[1])],
        positionMm: [roundMm((p0[0] + p1[0]) / 2), roundMm((p0[1] + p1[1]) / 2)],
      };
      break;
  }

  return { type: "add-annotation", sheetId: sheet.id, annotation };
}
