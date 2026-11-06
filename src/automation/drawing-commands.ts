import { applyDrawingCommand, buildDrawing, createDrawingDocument, drawingExportResult, parseDrawingDocument, serializeDrawingDocument, type DrawingCommand, type DrawingProjector } from "@aether/core/drawing";
import { parsePartDocument } from "@aether/core/document";

export const drawingCommandDocs = {
  phase: "drawing",
  operations: ["create", "mutate", "inspect", "export"],
  content: "create: the source Part document JSON; other operations: the Drawing document JSON. Returned content is a complete drawing including its source snapshot.",
  command_types: ["add-sheet", "select-sheet", "update-sheet", "remove-sheet", "add-view", "update-view", "remove-view", "add-annotation", "update-annotation", "remove-annotation", "refresh-source"],
  orientations: ["front", "back", "top", "bottom", "left", "right", "isometric"],
  annotations: ["note", "width", "height", "diameter", "radius", "angle", "length", "point-distance", "point-angle", "balloon", "center-mark"],
  exports: ["svg", "dxf", "pdf"],
  rules: ["Coordinates and paper sizes are millimeters; scale is paper/model.", "A projected view references an independent front view, inherits scale and follows its sheet's first/third-angle alignment.", "Overall width/height dimensions reference view IDs and measure model geometry, never page pixels.", "Refresh requires a Part with the same documentId. Build failure returns no changed content.", "An independent principal view can set section:{offsetMm,hatchSpacingMm?}. Offset is world X for left/right, Y for front/back or Z for top/bottom in model mm; nearer material is removed. Hatch spacing is paper mm (default 2). Sections require format 2. Clear with section:null. A section cannot be a projection parent.", "PDF returns data_base64 and mime_type; SVG/DXF return text. all_sheets:true exports PDF pages in document order and cannot be combined with sheet_id. PDF embeds the bundled Noto Sans font; unsupported glyphs are refused. Assembly sources are not implemented yet. Attached edge and point dimensions measure projected model geometry. Point-distance (two endpoint/centre picks) and point-angle (endpoint, vertex, endpoint) require Drawing format 5; ambiguous or missing picks are refused."],
};

/** The saved runner uses the exact same document commands and projector as the
 * browser. This is a local CAD command surface, not a Studio RPC alias. */
export async function executeDrawingRequest(request: Record<string, unknown>, project: DrawingProjector, loadFont: () => Promise<Uint8Array> = async () => { throw Error("Drawing PDF font loader is unavailable."); }) {
  if (request.phase === "drawing_docs") return drawingCommandDocs;
  if (Object.keys(request).some(key => !["phase", "operation", "content", "command", "format", "sheet_id", "all_sheets"].includes(key))) throw Error("Unknown drawing request argument.");
  if (typeof request.content !== "string") throw Error("Drawing operation requires serialized content.");
  if (!["create", "mutate", "inspect", "export"].includes(String(request.operation))) throw Error("Unknown drawing operation.");
  if (request.operation !== "mutate" && request.command !== undefined) throw Error("Only mutate accepts a drawing command.");
  if (request.operation !== "export" && (request.format !== undefined || request.sheet_id !== undefined || request.all_sheets !== undefined)) throw Error("Only export accepts a format or sheet selection.");
  const source = request.operation === "create" ? createDrawingDocument(parsePartDocument(request.content)) : parseDrawingDocument(request.content);
  if (request.operation === "mutate" && (!request.command || typeof request.command !== "object" || Array.isArray(request.command))) throw Error("mutate requires a drawing command.");
  let command = request.command as DrawingCommand;
  // Refresh receives a serialized Part just like create: migrate supported older
  // source versions at this boundary before canonical validation.
  if (request.operation === "mutate" && command.type === "refresh-source") {
    command = { ...command, source: parsePartDocument(JSON.stringify(command.source)) };
  }
  const document = request.operation === "mutate" ? applyDrawingCommand(source, command) : source;
  if (document.source.features.length > 512) throw Error("Drawing automation supports source Parts with at most 512 features.");
  const built = await buildDrawing(document, project);
  if (request.operation === "export") {
    return { status: "ok", ...await drawingExportResult(built, { format: request.format, sheetId: request.sheet_id, allSheets: request.all_sheets }, loadFont) };
  }
  return { status: "ok", content: serializeDrawingDocument(document), revision: built.revision, source_hash: built.sourceHash, drawing_id: document.documentId, active_sheet_id: document.activeSheetId,
    sheets: built.sheets.map(({ sheet, views, annotations }) => ({ id: sheet.id, name: sheet.name, size_mm: [sheet.widthMm, sheet.heightMm], projection: sheet.projection, views: views.map(v => ({ id: v.view.id, name: v.view.name, orientation: v.view.orientation, section: v.view.section ?? null, hatch_lines: v.geometry.hatch?.length ?? 0, scale: v.view.scale, origin_mm: v.view.originMm, model_bounds_mm: v.geometry.bounds, sheet_bounds_mm: v.boundsMm, body_ids: v.geometry.bodyIds, visible_curves: v.geometry.visible.length, hidden_curves: v.geometry.hidden.length })), annotations: annotations.map(a => ({ id: a.id, text: a.text, value_mm: a.valueMm, value_deg: a.valueDeg, view_id: a.viewId })) })),
  };
}
