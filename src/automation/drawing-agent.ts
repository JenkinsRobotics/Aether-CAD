import type { AgentInteraction, AgentTool } from "@aether/ui/AgentServices";
import { drawingExportResult, type DrawingCommand, type BuiltDrawing } from "@aether/core/drawing";
import { loadDrawingFont } from "../drawing/pdf-export";
import type { DrawingEditor } from "../drawing/controller";
import { knowledgeTool } from "../ai/catalog";
import { discoverCAD } from "../ai/knowledge";
import { validateToolArguments } from './tool-arguments';

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): AgentTool => ({ name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } });
const revision = { expected_revision: { type: "string", description: "Exact drawing revision returned by inspect or the last successful edit." } };
export const drawingAgentTools: AgentTool[] = [
  knowledgeTool,
  tool("aether_cad_drawing_inspect", "Inspect the current drawing, source link, sheets, view IDs and exact model bounds, overall dimensions and notes. Defaults to the active sheet; annotation pages contain at most 50 items.", { sheet_id: { type: "string" }, offset: { type: "integer", minimum: 0 } }),
  tool("aether_cad_drawing_edit", "Apply one validated DrawingCommand JSON as one undo step. Coordinates and paper sizes are mm; scale is paper/model. Supported types: add-sheet, select-sheet, update-sheet, remove-sheet, add-view, update-view, remove-view, add-annotation, update-annotation, remove-annotation. Inspect IDs first. Projection or validation failure preserves the previous drawing.", { ...revision, command_json: { type: "string", description: 'Examples: {"type":"add-view","sheetId":"from inspect","view":{"id":"front","name":"Front","orientation":"front","originMm":[80,110],"scale":1,"hiddenLines":true}}; {"type":"add-annotation","sheetId":"from inspect","annotation":{"id":"width","kind":"width","viewId":"front","positionMm":[80,140],"decimals":2}}. A section adds section:{offsetMm,hatchSpacingMm:2} to an independent principal view; offset is world X for left/right, Y for front/back, Z for top/bottom, in model mm. Nearer material is removed, hatch spacing is paper mm. Clear with section:null. A note uses kind:"note", text and positionMm. A projected top/bottom/left/right view uses parentId of a base front view. update-view has viewId and changes; remove-view has viewId. Sheets have id,name,widthMm,heightMm,projection:"first_angle"|"third_angle",views:[],annotations:[].' } }, ["expected_revision", "command_json"]),
  tool("aether_cad_drawing_refresh", "Read the saved source Part from its original Studio file/branch and rebuild all drawing views and dimensions. Keeps the previous drawing if the source is missing, inaccessible or fails to build.", revision, ["expected_revision"]),
  tool("aether_cad_drawing_undo", "Undo one drawing edit; source refresh is undoable.", revision, ["expected_revision"]),
  tool("aether_cad_drawing_redo", "Redo one drawing edit.", revision, ["expected_revision"]),
  tool("aether_cad_drawing_export", "Return SVG/DXF text or PDF data_base64 and mime_type, in physical millimeters, with the inspected revision. Defaults to the active sheet. PDF can export all sheets in document order. Does not save or publish a file. Larger exports remain available from the UI.", { ...revision, format: { type: "string", enum: ["svg", "dxf", "pdf"] }, sheet_id: { type: "string" }, all_sheets: { type: "boolean", description: "PDF only; mutually exclusive with sheet_id." } }, ["expected_revision", "format"]),
];
export function inspectDrawing(built: BuiltDrawing, args: Record<string, unknown> = {}) {
  const sheet = built.sheets.find(s => s.sheet.id === (args.sheet_id ?? built.document.activeSheetId));
  if (!sheet) throw Error("Drawing sheet does not exist.");
  const offset = args.offset ?? 0;
  if (!Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 1000) throw Error("Annotation offset must be an integer from 0 to 1000.");
  return { drawing_id: built.document.documentId, name: built.document.name, revision: built.revision, source_hash: built.sourceHash,
    source_document_id: built.document.source.documentId, source_reference: built.document.sourceReference ?? null,
    active_sheet_id: built.document.activeSheetId, sheets: built.sheets.map(s => ({ id: s.sheet.id, name: s.sheet.name })),
    sheet: { ...sheet.sheet, views: sheet.views.map(v => ({ ...v.view, hatch_lines: v.geometry.hatch?.length ?? 0, model_bounds_mm: v.geometry.bounds, body_ids: v.geometry.bodyIds })),
      annotations: sheet.sheet.annotations.slice(Number(offset), Number(offset) + 50).map(a => ({ ...a, value_mm: sheet.annotations.find(p => p.id === a.id)?.valueMm })),
      annotation_count: sheet.sheet.annotations.length, next_offset: Number(offset) + 50 < sheet.sheet.annotations.length ? Number(offset) + 50 : null },
    limits: ["Part sources only; base/projected/principal section views and overall width/height dimensions, notes, SVG/DXF/PDF.", "No stepped/isometric sections, cutting-line annotations, assembly sources/BOM or edge-attached/angular/radial dimensions yet."],
  };
}
export function drawingAgentInteraction(editor: DrawingEditor, contextKey: string, currentKey: () => string): AgentInteraction {
  return { contextKey, tools: drawingAgentTools, execute: async (call, signal) => {
    const checkContext = () => { signal.throwIfAborted(); if (contextKey !== currentKey()) throw Error("The active Drawing changed."); };
    checkContext();
    validateToolArguments(drawingAgentTools, call.name, call.arguments);
    if (call.name === "aether_cad_docs") return discoverCAD(drawingAgentTools, call.arguments, "drawing");
    const before = editor.snapshot(); if (!before) throw Error("Open a Drawing first.");
    if (call.arguments.sheet_id !== undefined && typeof call.arguments.sheet_id !== "string") throw Error("sheet_id must be a string.");
    if (call.name === "aether_cad_drawing_inspect") return { ...inspectDrawing(before, call.arguments), writable: editor.writable(), ...editor.history() };
    const check = () => { checkContext(); if (editor.snapshot() !== before || typeof call.arguments.expected_revision !== "string" || call.arguments.expected_revision !== before.revision) throw Error("The drawing revision changed. Inspect it before editing or exporting."); };
    check();
    if (call.name === "aether_cad_drawing_export") {
      const exported = await drawingExportResult(before, { format: call.arguments.format, sheetId: call.arguments.sheet_id, allSheets: call.arguments.all_sheets }, loadDrawingFont);
      check();
      const result = { changed: false, revision: before.revision, ...exported };
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 2 * 1024 * 1024) throw Error("This export exceeds the 2 MiB agent response limit. Use the Drawing Export control.");
      return result;
    }
    const guard = { signal, assertCurrent: check };
    if (call.name === "aether_cad_drawing_edit") {
      if (typeof call.arguments.command_json !== "string" || call.arguments.command_json.length > 256 * 1024) throw Error("Provide a drawing command JSON of at most 256 KiB.");
      const command = JSON.parse(call.arguments.command_json);
      if (!command || typeof command !== "object" || Array.isArray(command) || command.type === "refresh-source") throw Error("Use a drawing authoring command, or the refresh tool to read its saved source.");
      await editor.execute(command as DrawingCommand, guard);
    } else if (call.name === "aether_cad_drawing_refresh") await editor.refresh(guard);
    else {
      const direction = call.name === "aether_cad_drawing_undo" ? -1 : 1;
      if (!(direction < 0 ? editor.history().canUndo : editor.history().canRedo)) throw Error("No drawing edit is available in that history direction.");
      await editor.travel(direction, guard);
    }
    return { changed: true, ...inspectDrawing(editor.snapshot()!), ...editor.history() };
  } };
}
