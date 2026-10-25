import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { drawingCurvePath, type BuiltDrawing, type BuiltDrawingSheet } from "./build";

export interface DrawingPDFOptions {
  /** Runtime adapter supplies the product's bundled Noto Sans font. */
  fontBytes: Uint8Array;
  sheetId?: string;
  allSheets?: boolean;
}

const pointsPerMm = 72 / 25.4;

function selectedSheets(drawing: BuiltDrawing, options: DrawingPDFOptions): BuiltDrawingSheet[] {
  if (options.allSheets && options.sheetId !== undefined) {
    throw Error("Choose a single PDF sheet or all sheets, not both.");
  }
  const sheets = options.allSheets ? drawing.sheets : drawing.sheets.filter(
    sheet => sheet.sheet.id === (options.sheetId ?? drawing.document.activeSheetId),
  );
  if (!sheets.length) throw Error("Drawing sheet does not exist.");
  return sheets;
}

/** A vector print of the same built snapshot used by the canvas/SVG/DXF. Page
 * dimensions and line weights are physical mm. No DOM, network, model rebuild,
 * screenshots or font fallback enter this serializer. */
export async function exportDrawingPDF(drawing: BuiltDrawing, options: DrawingPDFOptions): Promise<Uint8Array> {
  const sheets = selectedSheets(drawing, options);
  const [{ PDFDocument, PrintScaling, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"), import("@pdf-lib/fontkit"),
  ]);
  const ink = rgb(0.13, 0.13, 0.13);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(options.fontBytes, { subset: true });
  const characters = new Set(font.getCharacterSet());
  const checkText = (text: string) => {
    for (const character of text.replace(/[\r\n\t]/g, "")) {
      if (!characters.has(character.codePointAt(0)!)) {
        throw Error(`The drawing PDF font does not contain ${JSON.stringify(character)}. Edit this text before exporting.`);
      }
    }
  };
  pdf.setTitle(drawing.document.name);
  pdf.setSubject("Aether CAD drawing; physical sheet dimensions in millimeters");
  pdf.setCreator("Aether CAD");
  pdf.setProducer("Aether CAD / pdf-lib");
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  for (const built of sheets) {
    const { sheet, views, annotations } = built;
    const page = pdf.addPage([sheet.widthMm * pointsPerMm, sheet.heightMm * pointsPerMm]);
    const stroke = (path: string, widthMm: number, hidden = false) => page.drawSvgPath(path, {
      x: 0, y: page.getHeight(), scale: pointsPerMm,
      borderColor: ink, borderWidth: widthMm,
      borderDashArray: hidden ? [3, 2] : [],
    });
    const label = (text: string, x: number, y: number, size = 3.5, align: "left" | "center" | "right" = "left") => {
      checkText(text);
      drawLabel(page, font, ink, text, x, y, size, align);
    };
    stroke(`M 10 10 L ${sheet.widthMm - 10} 10 L ${sheet.widthMm - 10} ${sheet.heightMm - 10} L 10 ${sheet.heightMm - 10} Z`, 0.35);
    for (const view of views) {
      for (const curve of view.geometry.hatch ?? []) stroke(drawingCurvePath(curve, view), 0.15);
      for (const curve of view.geometry.visible) stroke(drawingCurvePath(curve, view), 0.3);
      if (view.view.hiddenLines) {
        for (const curve of view.geometry.hidden) stroke(drawingCurvePath(curve, view), 0.18, true);
      }
      label(`${view.view.name} · ${view.view.scale}:1`, view.view.originMm[0], view.boundsMm[3] + 6, 3, "center");
    }
    for (const annotation of annotations) {
      for (const [a, b] of annotation.lines) stroke(`M ${a.join(" ")} L ${b.join(" ")}`, 0.2);
      label(annotation.text, ...annotation.positionMm, 3.5, annotation.textAlign);
    }
    const footer = `${drawing.document.name} · ${sheet.name} · mm · ${sheet.projection.replace("_", " ")}`;
    checkText(footer);
    // Keep full names in metadata; the printed footer must fit inside the border.
    label(fitFooter(footer, font, Math.max(1, sheet.widthMm - 24)), sheet.widthMm - 12, sheet.heightMm - 14, 3.5, "right");
  }
  return pdf.save();
}

function drawLabel(page: PDFPage, font: PDFFont, ink: RGB, text: string, x: number, y: number, sizeMm: number, align: "left" | "center" | "right") {
  const size = sizeMm * pointsPerMm;
  text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n").forEach((line, index) => {
    const width = font.widthOfTextAtSize(line, size);
    const offset = align === "center" ? width / 2 : align === "right" ? width : 0;
    page.drawText(line, {
      x: x * pointsPerMm - offset,
      y: page.getHeight() - (y + index * sizeMm * 1.3) * pointsPerMm,
      font, size, color: ink,
    });
  });
}

function fitFooter(text: string, font: PDFFont, availableMm: number): string {
  const fits = (value: string) => font.widthOfTextAtSize(value, 3.5) <= availableMm;
  if (fits(text)) return text;
  const characters = [...text];
  while (characters.length && !fits(characters.join("") + "…")) characters.pop();
  return characters.length ? characters.join("") + "…" : "";
}
