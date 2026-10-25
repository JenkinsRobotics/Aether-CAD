import { drawingCurvePath, sheetPoint, type BuiltDrawing } from "./build";
const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const sheetOf = (drawing: BuiltDrawing, id: string) => { const sheet = drawing.sheets.find(s => s.sheet.id === id); if (!sheet) throw Error("Drawing sheet does not exist."); return sheet; };

export function exportDrawingSVG(drawing: BuiltDrawing, sheetId = drawing.document.activeSheetId): string {
  const { sheet, views, annotations } = sheetOf(drawing, sheetId);
  const elements = [`<title>${xml(drawing.document.name)} — ${xml(sheet.name)}</title>`, `<rect width="100%" height="100%" fill="white"/>`, `<rect x="10" y="10" width="${sheet.widthMm - 20}" height="${sheet.heightMm - 20}" fill="none" stroke="#222" stroke-width="0.35"/>`];
  for (const view of views) {
    for (const curve of view.geometry.hatch ?? []) elements.push(`<path data-layer="hatch" d="${drawingCurvePath(curve, view)}" fill="none" stroke="#222" stroke-width="0.15"/>`);
    for (const [curves, hidden] of [[view.geometry.visible, false], [view.view.hiddenLines ? view.geometry.hidden : [], true]] as const) for (const curve of curves) {
      elements.push(`<path d="${drawingCurvePath(curve, view)}" fill="none" stroke="#222" stroke-width="${hidden ? 0.18 : 0.3}"${hidden ? ' stroke-dasharray="3 2"' : ""}/>`);
    }
    elements.push(`<text x="${view.view.originMm[0]}" y="${view.boundsMm[3] + 6}" font-size="3" text-anchor="middle">${xml(view.view.name)} · ${view.view.scale}:1</text>`);
  }
  for (const annotation of annotations) {
    for (const [a, b] of annotation.lines) elements.push(`<path d="M ${a.join(" ")} L ${b.join(" ")}" stroke="#222" stroke-width="0.2" fill="none"/>`);
    elements.push(`<text x="${annotation.positionMm[0]}" y="${annotation.positionMm[1]}" font-size="3.5"${annotation.textAlign === "center" ? ' text-anchor="middle"' : ""}>${xml(annotation.text)}</text>`);
  }
  elements.push(`<text x="${sheet.widthMm - 12}" y="${sheet.heightMm - 14}" font-size="3.5" text-anchor="end">${xml(drawing.document.name)} · ${xml(sheet.name)} · mm · ${sheet.projection.replace("_", " ")}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.widthMm}mm" height="${sheet.heightMm}mm" viewBox="0 0 ${sheet.widthMm} ${sheet.heightMm}" font-family="sans-serif">${elements.join("\n")}</svg>`;
}

/** R2000 ASCII DXF, in physical sheet millimeters. Lines/circles/arcs remain
 * analytic. Other curves retain their explicitly bounded display tessellation. */
export function exportDrawingDXF(drawing: BuiltDrawing, sheetId = drawing.document.activeSheetId): string {
  const { sheet, views, annotations } = sheetOf(drawing, sheetId);
  const out: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1015", 9, "$INSUNITS", 70, 4, 0, "ENDSEC", 0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LTYPE", 70, 2, 0, "LTYPE", 2, "CONTINUOUS", 70, 0, 3, "Solid", 72, 65, 73, 0, 40, 0, 0, "LTYPE", 2, "HIDDEN", 70, 0, 3, "Hidden", 72, 65, 73, 2, 40, 5, 49, 3, 74, 0, 49, -2, 74, 0, 0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES"];
  const line = (a: readonly number[], b: readonly number[], hidden = false, layer = hidden ? "HIDDEN" : "VISIBLE") => out.push(0, "LINE", 100, "AcDbEntity", 8, layer, 6, hidden ? "HIDDEN" : "CONTINUOUS", 100, "AcDbLine", 10, a[0], 20, sheet.heightMm - a[1], 30, 0, 11, b[0], 21, sheet.heightMm - b[1], 31, 0);
  const text = (value: string, position: readonly number[], align: "left" | "center" = "left") => {
    const escaped = value.replace(/[\x00-\x1f]/g, " ").replace(/[^\x20-\x7e]/g, c => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    out.push(0, "TEXT", 100, "AcDbEntity", 8, "ANNOTATIONS", 100, "AcDbText",
      10, position[0], 20, sheet.heightMm - position[1], 30, 0, 40, 3.5, 1, escaped);
    // DXF TEXT horizontal justification and second alignment point.
    if (align === "center") out.push(72, 1, 11, position[0], 21, sheet.heightMm - position[1], 31, 0);
    out.push(100, "AcDbText", 73, 0);
  };
  const border = [[10, 10], [sheet.widthMm - 10, 10], [sheet.widthMm - 10, sheet.heightMm - 10], [10, sheet.heightMm - 10]];
  border.forEach((p, i) => line(p, border[(i + 1) % 4], false, "SHEET"));
  for (const view of views) for (const [curves, hidden] of [[view.geometry.visible, false], [view.view.hiddenLines ? view.geometry.hidden : [], true]] as const) for (const curve of curves) {
    if (curve.kind === "line") line(sheetPoint(view, curve.start), sheetPoint(view, curve.end), hidden);
    else if (curve.kind === "polyline") curve.points.slice(1).forEach((p, i) => line(sheetPoint(view, curve.points[i]), sheetPoint(view, p), hidden));
    else {
      const center = sheetPoint(view, curve.center);
      out.push(0, curve.kind === "circle" ? "CIRCLE" : "ARC", 100, "AcDbEntity", 8, hidden ? "HIDDEN" : "VISIBLE", 6, hidden ? "HIDDEN" : "CONTINUOUS", 100, "AcDbCircle", 10, center[0], 20, sheet.heightMm - center[1], 30, 0, 40, curve.radius * view.view.scale);
      if (curve.kind === "arc") out.push(100, "AcDbArc", 50, (curve.ccw ? curve.start : curve.end) * 180 / Math.PI, 51, (curve.ccw ? curve.end : curve.start) * 180 / Math.PI);
    }
  }
  for (const view of views) for (const hatch of view.geometry.hatch ?? []) line(sheetPoint(view, hatch.start), sheetPoint(view, hatch.end), false, "HATCH");
  for (const annotation of annotations) {
    annotation.lines.forEach(([a, b]) => line(a, b, false, "ANNOTATIONS"));
    text(annotation.text, annotation.positionMm, annotation.textAlign);
  }
  text(`${drawing.document.name} / ${sheet.name} / mm`, [12, sheet.heightMm - 14]);
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}
