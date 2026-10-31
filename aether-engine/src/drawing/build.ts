import type { PartDocument } from "../document/part-document";
import { availableBodies } from "../document/feature-history";
import { sha256Hex } from "../kernel/sha256";
import { resolvedDrawingView, validateDrawingDocument, type DrawingDocument, type DrawingPoint, type DrawingSheet, type DrawingView } from "./document";
import type { PartDrawingOptions, PartDrawingProjection, ProjectedDrawingCurve } from "./projection";
import { attachedDimension } from "./attached-dimensions";
import { circleChords, clipProjectionToCircle } from "./detail-view";

export type DrawingProjector = (source: PartDocument, options: PartDrawingOptions) => Promise<PartDrawingProjection>;
export interface BuiltDrawingView {
  view: DrawingView;
  geometry: PartDrawingProjection;
  boundsMm: [number, number, number, number];
  /** Model-view origin in sheet coordinates (sheet Y points down). */
  translationMm: DrawingPoint;
}
export interface BuiltDrawingAnnotation {
  id: string;
  text: string;
  positionMm: DrawingPoint;
  textAlign: "left" | "center";
  valueMm?: number;
  /** Angle dimensions carry degrees; `valueMm` stays undefined. */
  valueDeg?: number;
  measure?: "length" | "diameter" | "radius" | "angle";
  /** Symbol annotations carry no measurement; detail markers are generated per detail view. */
  symbol?: "balloon" | "center-mark" | "detail-marker";
  viewId?: string;
  lines: [DrawingPoint, DrawingPoint][];
}
/** The parts list as built: one row per available part of the source, in tree order. */
export interface BuiltPartsList { originMm: DrawingPoint; widthMm: number; columns: readonly string[]; rows: { key: string; bodyId: string; cells: string[] }[] }
export const partsListColumns = ["item", "part", "quantity", "material"] as const;
export interface BuiltDrawingSheet { sheet: DrawingSheet; views: BuiltDrawingView[]; annotations: BuiltDrawingAnnotation[]; partsList?: BuiltPartsList }
export interface BuiltDrawing { document: DrawingDocument; revision: string; sourceHash: string; sheets: BuiltDrawingSheet[]; approximatedCurveCount: number }

export async function buildDrawing(input: DrawingDocument, project: DrawingProjector): Promise<BuiltDrawing> {
  const document = structuredClone(input);
  validateDrawingDocument(document);
  const result: BuiltDrawing = { document, revision: sha256Hex(JSON.stringify(document)), sourceHash: sha256Hex(JSON.stringify(document.source)), sheets: [], approximatedCurveCount: 0 };
  const cache = new Map<string, PartDrawingProjection>();
  for (const sheet of document.sheets) {
    const built: BuiltDrawingSheet = { sheet, views: [], annotations: [] };
    // Details are built after the views they enlarge.
    for (const authored of [...sheet.views.filter(v => !v.detail), ...sheet.views.filter(v => v.detail)]) {
      const view = resolvedDrawingView(sheet, authored);
      let geometry: PartDrawingProjection | undefined;
      if (view.detail) {
        const parent = built.views.find(v => v.view.id === view.detail!.parentId)!;
        const { centerMm, radiusMm, label } = view.detail, ps = parent.view.scale;
        const modelCenter: DrawingPoint = [(centerMm[0] - parent.translationMm[0]) / ps, (parent.translationMm[1] - centerMm[1]) / ps];
        geometry = clipProjectionToCircle(parent.geometry, modelCenter, radiusMm / ps);
        built.annotations.push({ id: `${view.id}/marker`, symbol: "detail-marker", viewId: parent.view.id, text: label, textAlign: "left", positionMm: [centerMm[0] + radiusMm * 0.75, centerMm[1] - radiusMm * 0.75 - 1], lines: circleChords(centerMm, radiusMm) });
      } else {
        const options = { orientation: view.orientation, ...(view.bodyIds ? { bodyIds: view.bodyIds } : {}), ...(view.section ? { section: { ...view.section, modelSpacingMm: (view.section.hatchSpacingMm ?? 2) / view.scale } } : {}), ...(view.direction ? { direction: view.direction } : {}) };
        const key = JSON.stringify(options);
        geometry = cache.get(key);
        if (!geometry) { geometry = await project(document.source, options); cache.set(key, geometry); }
      }
      const [x0, y0, x1, y1] = geometry.bounds, s = view.scale;
      if (!geometry.bounds.every(Number.isFinite) || x1 < x0 || y1 < y0) throw Error("Drawing projection returned invalid bounds.");
      const translationMm: DrawingPoint = [view.originMm[0] - s * (x0 + x1) / 2, view.originMm[1] + s * (y0 + y1) / 2];
      built.views.push({ view, geometry, translationMm, boundsMm: [translationMm[0] + s * x0, translationMm[1] - s * y1, translationMm[0] + s * x1, translationMm[1] - s * y0] });
      result.approximatedCurveCount += geometry.visible.concat(view.hiddenLines ? geometry.hidden : []).filter(c => c.kind === "polyline").length;
    }
    for (const annotation of sheet.annotations) {
      if (annotation.kind === "note") { built.annotations.push({ id: annotation.id, text: annotation.text, positionMm: annotation.positionMm, textAlign: "left", lines: [] }); continue; }
      if (annotation.kind === "balloon") { built.annotations.push(balloon(annotation.id, annotation.text, annotation.positionMm, annotation.leaderMm)); continue; }
      const view = built.views.find(v => v.view.id === annotation.viewId)!;
      if (annotation.kind === "diameter" || annotation.kind === "radius" || annotation.kind === "angle" || annotation.kind === "center-mark" || annotation.kind === "length") { built.annotations.push(attachedDimension(annotation, view)); continue; }
      const [x0, y0, x1, y1] = view.boundsMm;
      const horizontal = annotation.kind === "width";
      const valueMm = horizontal ? view.geometry.bounds[2] - view.geometry.bounds[0] : view.geometry.bounds[3] - view.geometry.bounds[1];
      const [x, y] = annotation.positionMm;
      const a: DrawingPoint = horizontal ? [x0, y] : [x, y0], b: DrawingPoint = horizontal ? [x1, y] : [x, y1];
      const baseline = horizontal ? (y < y0 ? y0 : y1) : (x < x0 ? x0 : x1);
      const lines: [DrawingPoint, DrawingPoint][] = [
        [a, b],
        [horizontal ? [x0, baseline] : [baseline, y0], horizontal ? [x0, y + 2] : [x + 2, y0]],
        [horizontal ? [x1, baseline] : [baseline, y1], horizontal ? [x1, y + 2] : [x + 2, y1]],
      ];
      // Closed arrowheads are three short line segments; lengths are paper mm.
      for (const [tip, direction] of [[a, 1], [b, -1]] as const) {
        const p: DrawingPoint = horizontal ? [tip[0] + direction * 2, tip[1] - 0.7] : [tip[0] - 0.7, tip[1] + direction * 2];
        const q: DrawingPoint = horizontal ? [tip[0] + direction * 2, tip[1] + 0.7] : [tip[0] + 0.7, tip[1] + direction * 2];
        lines.push([tip, p], [p, q], [q, tip]);
      }
      built.annotations.push({ id: annotation.id, viewId: annotation.viewId, text: valueMm.toFixed(annotation.decimals), valueMm, measure: "length", textAlign: horizontal ? "center" : "left", positionMm: horizontal ? [(x0 + x1) / 2, y - 1.5] : [x + 1.5, (y0 + y1) / 2], lines });
    }
    if (sheet.partsList) {
      // Every part is one item, quantity 1: a Part drawing lists its own parts (assembly sources are not drawn yet).
      const rows = availableBodies(document.source).map((body, i) => ({ key: body.id, bodyId: body.id, cells: [String(i + 1), body.name, "1", document.source.bodyProperties?.[body.id]?.material?.name ?? ""] }));
      built.partsList = { originMm: sheet.partsList.originMm, widthMm: sheet.partsList.widthMm ?? 120, columns: partsListColumns, rows };
    }
    result.sheets.push(built);
  }
  return result;
}

/** A 4 mm radius circle around the text with a leader and arrowhead to the item. */
function balloon(id: string, text: string, center: DrawingPoint, target: DrawingPoint): BuiltDrawingAnnotation {
  const radius = 4, d = Math.hypot(target[0] - center[0], target[1] - center[1]);
  const lines = circleChords(center, radius);
  if (d > radius) {
    const u: DrawingPoint = [(target[0] - center[0]) / d, (target[1] - center[1]) / d], edge: DrawingPoint = [center[0] + u[0] * radius, center[1] + u[1] * radius];
    const base: DrawingPoint = [target[0] - u[0] * 2, target[1] - u[1] * 2], p: DrawingPoint = [base[0] - u[1] * 0.7, base[1] + u[0] * 0.7], q: DrawingPoint = [base[0] + u[1] * 0.7, base[1] - u[0] * 0.7];
    lines.push([edge, target], [target, p], [p, q], [q, target]);
  }
  // Text baseline sits 1.25 mm below the centre so 3.5 mm capitals read centred.
  return { id, symbol: "balloon", text, textAlign: "center", positionMm: [center[0], center[1] + 1.25], lines };
}

export function sheetPoint(view: BuiltDrawingView, point: DrawingPoint): DrawingPoint {
  return [view.translationMm[0] + point[0] * view.view.scale, view.translationMm[1] - point[1] * view.view.scale];
}
/** SVG uses a downward Y axis. Transform angles and orientation together. */
export function drawingCurvePath(curve: ProjectedDrawingCurve, view: BuiltDrawingView): string {
  const p = (point: DrawingPoint) => sheetPoint(view, point).join(" ");
  if (curve.kind === "line") return `M ${p(curve.start)} L ${p(curve.end)}`;
  if (curve.kind === "polyline") return curve.points.map((point, i) => `${i ? "L" : "M"} ${p(point)}`).join(" ");
  const r = curve.radius * view.view.scale;
  if (curve.kind === "circle") {
    const [x, y] = sheetPoint(view, curve.center);
    return `M ${x + r} ${y} A ${r} ${r} 0 1 0 ${x - r} ${y} A ${r} ${r} 0 1 0 ${x + r} ${y}`;
  }
  const start: DrawingPoint = [curve.center[0] + curve.radius * Math.cos(curve.start), curve.center[1] + curve.radius * Math.sin(curve.start)];
  const end: DrawingPoint = [curve.center[0] + curve.radius * Math.cos(curve.end), curve.center[1] + curve.radius * Math.sin(curve.end)];
  const sweep = ((curve.ccw ? curve.end - curve.start : curve.start - curve.end) + 2 * Math.PI) % (2 * Math.PI);
  return `M ${p(start)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} ${curve.ccw ? 0 : 1} ${p(end)}`;
}
