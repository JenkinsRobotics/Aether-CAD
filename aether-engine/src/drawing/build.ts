import type { PartDocument } from "../document/part-document";
import { sha256Hex } from "../kernel/sha256";
import { resolvedDrawingView, validateDrawingDocument, type DrawingDocument, type DrawingPoint, type DrawingSheet, type DrawingView } from "./document";
import type { PartDrawingOptions, PartDrawingProjection, ProjectedDrawingCurve } from "./projection";

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
  valueMm?: number;
  viewId?: string;
  lines: [DrawingPoint, DrawingPoint][];
}
export interface BuiltDrawingSheet { sheet: DrawingSheet; views: BuiltDrawingView[]; annotations: BuiltDrawingAnnotation[] }
export interface BuiltDrawing { document: DrawingDocument; revision: string; sourceHash: string; sheets: BuiltDrawingSheet[]; approximatedCurveCount: number }

export async function buildDrawing(input: DrawingDocument, project: DrawingProjector): Promise<BuiltDrawing> {
  const document = structuredClone(input);
  validateDrawingDocument(document);
  const result: BuiltDrawing = { document, revision: sha256Hex(JSON.stringify(document)), sourceHash: sha256Hex(JSON.stringify(document.source)), sheets: [], approximatedCurveCount: 0 };
  const cache = new Map<string, PartDrawingProjection>();
  for (const sheet of document.sheets) {
    const built: BuiltDrawingSheet = { sheet, views: [], annotations: [] };
    for (const authored of sheet.views) {
      const view = resolvedDrawingView(sheet, authored);
      const options = { orientation: view.orientation, ...(view.bodyIds ? { bodyIds: view.bodyIds } : {}) };
      const key = JSON.stringify(options);
      let geometry = cache.get(key);
      if (!geometry) { geometry = await project(document.source, options); cache.set(key, geometry); }
      const [x0, y0, x1, y1] = geometry.bounds, s = view.scale;
      if (!geometry.bounds.every(Number.isFinite) || x1 < x0 || y1 < y0) throw Error("Drawing projection returned invalid bounds.");
      const translationMm: DrawingPoint = [view.originMm[0] - s * (x0 + x1) / 2, view.originMm[1] + s * (y0 + y1) / 2];
      built.views.push({ view, geometry, translationMm, boundsMm: [translationMm[0] + s * x0, translationMm[1] - s * y1, translationMm[0] + s * x1, translationMm[1] - s * y0] });
      result.approximatedCurveCount += geometry.visible.concat(view.hiddenLines ? geometry.hidden : []).filter(c => c.kind === "polyline").length;
    }
    for (const annotation of sheet.annotations) {
      if (annotation.kind === "note") { built.annotations.push({ id: annotation.id, text: annotation.text, positionMm: annotation.positionMm, lines: [] }); continue; }
      const view = built.views.find(v => v.view.id === annotation.viewId)!;
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
      built.annotations.push({ id: annotation.id, viewId: annotation.viewId, text: valueMm.toFixed(annotation.decimals), valueMm, positionMm: horizontal ? [(x0 + x1) / 2, y - 1.5] : [x + 1.5, (y0 + y1) / 2], lines });
    }
    result.sheets.push(built);
  }
  return result;
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
