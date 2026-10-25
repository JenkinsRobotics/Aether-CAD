import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createRectanglePartDocument } from "../document/part-document";
import { createDrawingDocument } from "./document";
import { buildDrawing } from "./build";
import { exportDrawingPDF } from "./pdf";
import { drawingExportResult } from "./export-result";

const fontBytes = readFileSync(createRequire(import.meta.url).resolve("@aether/assets/fonts/noto-sans/NotoSans-Regular.ttf"));
async function fixture() {
  const document = createDrawingDocument(createRectanglePartDocument("Plate Ω", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 }));
  document.sheets[0].name = "Engineering";
  document.sheets[0].views.push({ id: "front", name: "Front", orientation: "front", originMm: [80, 100], scale: 0.5, hiddenLines: true });
  document.sheets[0].annotations.push(
    { id: "width", kind: "width", viewId: "front", decimals: 2, positionMm: [80, 130] },
    { id: "note", kind: "note", text: "Tolerance ±0.1 mm\nУгол 90°", positionMm: [20, 170] },
  );
  document.sheets.push({ id: "detail", name: "Detail", widthMm: 210, heightMm: 297, projection: "third_angle", views: [], annotations: [] });
  return buildDrawing(document, async () => ({
    visible: [
      { kind: "line", start: [0, 0], end: [40, 0] },
      { kind: "circle", center: [20, 10], radius: 4 },
      { kind: "arc", center: [20, 10], radius: 6, start: 0, end: Math.PI, ccw: true },
      { kind: "polyline", points: [[0, 0], [10, 20], [40, 0]], toleranceMm: 0.01 },
    ],
    hidden: [{ kind: "line", start: [0, 5], end: [40, 5] }],
    hatch: [{ kind: "line", start: [0, 0], end: [10, 10] }],
    bounds: [0, 0, 40, 20], bodyIds: ["body"],
  }));
}

it("writes vector pages in physical mm, with embedded Unicode font, styles and print scaling disabled", async () => {
  const built = await fixture();
  const pdf = await PDFDocument.load(await exportDrawingPDF(built, { fontBytes, allSheets: true }));
  expect(pdf.getPages()).toHaveLength(2);
  [[297, 210], [210, 297]].forEach(([width, height], index) => {
    expect(pdf.getPage(index).getWidth()).toBeCloseTo(width * 72 / 25.4, 9);
    expect(pdf.getPage(index).getHeight()).toBeCloseTo(height * 72 / 25.4, 9);
  });
  expect(pdf.getTitle()).toBe(built.document.name);
  expect(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling()).toBe("None");
  const page = pdf.getPage(0);
  const streams = page.node.Contents() as PDFArray;
  const operators = streams.asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
  expect(operators).toContain("[3 2] 0 d");
  expect(operators).toContain("0.15 w");
  expect(operators).toContain("0.3 w");
  expect(operators).toContain("0.18 w");
  expect(operators).toContain("0.2 w");
  expect(operators).toMatch(/\bc\n/); // Circular geometry stays vector Bézier paths.
  expect(operators).toMatch(/\bTj\n/); // Text remains text, rather than a screenshot.
  expect(page.node.Resources()?.lookup(PDFName.of("Font"))).toBeDefined();
  expect(operators).not.toMatch(/\bDo\n/); // No raster image XObjects.
  expect(built.sheets[0].annotations[0].valueMm).toBe(40);
});

it("exports the active or selected sheet, and refuses ambiguous/missing sheets and missing glyphs", async () => {
  const built = await fixture();
  const active = await PDFDocument.load(await exportDrawingPDF(built, { fontBytes }));
  expect(active.getPageCount()).toBe(1);
  const detail = await PDFDocument.load(await exportDrawingPDF(built, { fontBytes, sheetId: "detail" }));
  expect(detail.getPage(0).getHeight()).toBeCloseTo(297 * 72 / 25.4, 9);
  await expect(exportDrawingPDF(built, { fontBytes, sheetId: "missing" })).rejects.toThrow(/does not exist/);
  await expect(exportDrawingPDF(built, { fontBytes, sheetId: "detail", allSheets: true })).rejects.toThrow(/not both/);
  built.sheets[0].annotations[1].text = "\u{10FFFF}";
  await expect(exportDrawingPDF(built, { fontBytes })).rejects.toThrow(/font does not contain/);
});

it("uses the same lossless binary envelope for headless and live agents, with strict selection validation", async () => {
  const built = await fixture();
  const result = await drawingExportResult(built, { format: "pdf", allSheets: true }, async () => fontBytes);
  expect(result).toMatchObject({ format: "pdf", mime_type: "application/pdf" });
  if (result.format !== "pdf") throw Error("PDF binary result missing");
  expect((await PDFDocument.load(Buffer.from(result.data_base64, "base64"))).getPageCount()).toBe(2);
  const unused = async (): Promise<Uint8Array> => { throw Error("Text export must not need a font"); };
  expect(await drawingExportResult(built, { format: "svg" }, unused)).toMatchObject({ text: expect.stringContaining("40.00") });
  for (const request of [{ format: "pdf", allSheets: "true" }, { format: "svg", allSheets: true }, { format: "pdf", sheetId: 42 }, { format: "png" }]) {
    await expect(drawingExportResult(built, request, unused)).rejects.toThrow();
  }
});
