import type { BuiltDrawing } from "./build";
import { exportDrawingDXF, exportDrawingSVG } from "./export";
import { exportDrawingPDF } from "./pdf";

export interface DrawingExportRequest {
  format: unknown;
  sheetId?: unknown;
  allSheets?: unknown;
}

/** Shared UI-agent/headless result envelope. Binary output is base64, never a
 * lossy text conversion. A runtime font loader is needed only for PDF. */
export async function drawingExportResult(drawing: BuiltDrawing, request: DrawingExportRequest, loadFont: () => Promise<Uint8Array>) {
  if (typeof request.format !== "string" || !["svg", "dxf", "pdf"].includes(request.format)) throw Error("Choose SVG, DXF or PDF drawing export.");
  if (request.sheetId !== undefined && typeof request.sheetId !== "string") throw Error("sheet_id must be a string.");
  if (request.allSheets !== undefined && typeof request.allSheets !== "boolean") throw Error("all_sheets must be a boolean.");
  if (request.allSheets && (request.format !== "pdf" || request.sheetId !== undefined)) throw Error("All sheets is available for PDF only, without sheet_id.");
  if (request.format === "pdf") {
    const bytes = await exportDrawingPDF(drawing, {
      fontBytes: await loadFont(), sheetId: request.sheetId, allSheets: request.allSheets,
    });
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { format: "pdf" as const, mime_type: "application/pdf", data_base64: btoa(binary) };
  }
  return {
    format: request.format as "svg" | "dxf",
    text: request.format === "svg" ? exportDrawingSVG(drawing, request.sheetId) : exportDrawingDXF(drawing, request.sheetId),
  };
}
