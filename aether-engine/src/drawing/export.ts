import type { BuiltPartsList } from "./build";
import { drawingCurvePath, sheetPoint, type BuiltDrawing } from "./build";
import type { DrawingSheet } from "./document";
const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
/** Editable title-block rows sit in a box above the footer; the fixed footer stays. */
export function titleBlockRows(sheet: DrawingSheet): { x: number; y: number; width: number; height: number; rows: [string, string][] } | null {
  if (!sheet.titleBlock?.length) return null;
  const rows = sheet.titleBlock.map(row => [row.label, row.value] as [string, string]), height = 2 + 5 * rows.length;
  return { x: sheet.widthMm - 130, y: sheet.heightMm - 18 - height, width: 120, height, rows };
}
/** The parts-list grid in sheet mm: 5 mm rows (header first), equal columns; texts at their cell origins. */
export function partsListGrid(list: BuiltPartsList): { lines: [number, number, number, number][]; texts: { x: number; y: number; text: string; bold: boolean }[] } {
  const [x, y] = list.originMm, w = list.widthMm, rows = list.rows.length + 1, h = 5 * rows, cw = w / list.columns.length;
  const lines: [number, number, number, number][] = [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]];
  for (let r = 1; r < rows; r++) lines.push([x, y + 5 * r, x + w, y + 5 * r]);
  for (let c = 1; c < list.columns.length; c++) lines.push([x + cw * c, y, x + cw * c, y + h]);
  const texts = list.columns.map((column, c) => ({ x: x + cw * c + 1, y: y + 3.6, text: column, bold: true }));
  list.rows.forEach((row, r) => row.cells.forEach((cell, c) => texts.push({ x: x + cw * c + 1, y: y + 5 * (r + 1) + 3.6, text: cell, bold: false })));
  return { lines, texts };
}
const sheetOf = (drawing: BuiltDrawing, id: string) => { const sheet = drawing.sheets.find(s => s.sheet.id === id); if (!sheet) throw Error("Drawing sheet does not exist."); return sheet; };

export function exportDrawingSVG(drawing: BuiltDrawing, sheetId = drawing.document.activeSheetId): string {
  const { sheet, views, annotations, partsList } = sheetOf(drawing, sheetId);
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
    if (annotation.text) elements.push(`<text x="${annotation.positionMm[0]}" y="${annotation.positionMm[1]}" font-size="3.5"${annotation.textAlign === "center" ? ' text-anchor="middle"' : ""}>${xml(annotation.text)}</text>`);
  }
  if (partsList) {
    const grid = partsListGrid(partsList);
    grid.lines.forEach(([x0, y0, x1, y1]) => elements.push(`<line data-layer="parts-list" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#222" stroke-width="0.25"/>`));
    grid.texts.forEach(t => elements.push(`<text x="${t.x}" y="${t.y}" font-size="2.8"${t.bold ? ' font-weight="700"' : ""}>${xml(t.text)}</text>`));
  }
  const block = titleBlockRows(sheet);
  if (block) {
    elements.push(`<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="none" stroke="#222" stroke-width="0.3"/>`);
    block.rows.forEach(([label, value], i) => elements.push(`<text x="${block.x + 2}" y="${block.y + 4 + i * 5}" font-size="2.2" fill="#555">${xml(label)}</text>`, `<text x="${block.x + 24}" y="${block.y + 4 + i * 5}" font-size="2.8">${xml(value)}</text>`));
  }
  elements.push(`<text x="${sheet.widthMm - 12}" y="${sheet.heightMm - 14}" font-size="3.5" text-anchor="end">${xml(drawing.document.name)} · ${xml(sheet.name)} · mm · ${sheet.projection.replace("_", " ")}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.widthMm}mm" height="${sheet.heightMm}mm" viewBox="0 0 ${sheet.widthMm} ${sheet.heightMm}" font-family="sans-serif">${elements.join("\n")}</svg>`;
}

/** R2000 ASCII DXF, in physical sheet millimeters. Lines/circles/arcs remain
 * analytic. Other curves retain their explicitly bounded display tessellation. */
export function exportDrawingDXF(drawing: BuiltDrawing, sheetId = drawing.document.activeSheetId): string {
  const { sheet, views, annotations, partsList } = sheetOf(drawing, sheetId);
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
    if (annotation.text) text(annotation.text, annotation.positionMm, annotation.textAlign);
  }
  if (partsList) {
    const grid = partsListGrid(partsList);
    grid.lines.forEach(([x0, y0, x1, y1]) => line([x0, y0], [x1, y1], false, "PARTS_LIST"));
    grid.texts.forEach(t => text(t.text, [t.x, t.y]));
  }
  const block = titleBlockRows(sheet);
  if (block) {
    const corners = [[block.x, block.y], [block.x + block.width, block.y], [block.x + block.width, block.y + block.height], [block.x, block.y + block.height]];
    corners.forEach((p, i) => line(p, corners[(i + 1) % 4], false, "SHEET"));
    block.rows.forEach(([label, value], i) => text(`${label}: ${value}`, [block.x + 2, block.y + 4 + i * 5]));
  }
  text(`${drawing.document.name} / ${sheet.name} / mm`, [12, sheet.heightMm - 14]);
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}
