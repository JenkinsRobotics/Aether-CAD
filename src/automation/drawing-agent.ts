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
  tool("aether_cad_drawing_edit", "Apply one validated DrawingCommand JSON as one undo step. add-dimension-chain takes sheetId and chain:{id,viewId,pointsMm,positionMm,decimals,axis?}; 3–64 ordered points create consecutive editable dimensions in one undo step. Coordinates and paper sizes are mm; scale is paper/model. Supported types: add-sheet, select-sheet, update-sheet, remove-sheet, add-view, update-view, remove-view, add-annotation, add-dimension-chain, update-annotation, remove-annotation. Inspect IDs first. Projection or validation failure preserves the previous drawing.", { ...revision, command_json: { type: "string", description: 'Examples: {"type":"add-view","sheetId":"from inspect","view":{"id":"front","name":"Front","orientation":"front","originMm":[80,110],"scale":1,"hiddenLines":true}}; {"type":"add-annotation","sheetId":"from inspect","annotation":{"id":"width","kind":"width","viewId":"front","positionMm":[80,140],"decimals":2}}. A section adds section:{offsetMm,hatchSpacingMm:2} to an independent principal view; offset is world X for left/right, Y for front/back, Z for top/bottom, in model mm. Nearer material is removed, hatch spacing is paper mm. Clear with section:null. A note uses kind:"note", text and positionMm. Dimensions attached to edges: {"id":"d1","kind":"diameter"|"radius","viewId":"top","atMm":[83.4,60],"positionMm":[92,50],"decimals":2} measures the projected circle or arc nearest atMm (sheet mm, within 5 mm); {"kind":"angle","atMm":[80,112.6],"toMm":[90.1,110],"positionMm":[86,109]} measures the angle between the straight edges nearest the two picks in the sector those picks span. {"kind":"length","atMm":[80,40],"positionMm":[80,30],"decimals":1} measures the model length of the straight edge nearest atMm with the dimension line through positionMm. Point dimensions (format 5): kind:"point-distance", pointsMm:[[x1,y1],[x2,y2]], optional axis:"x"|"y"; or kind:"point-angle", pointsMm:[endpoint,vertex,endpoint]. Picks snap to unique native projected endpoints or circle centres within 5 sheet mm; ambiguous, missing, zero-length or collinear selections fail. Both use viewId, positionMm and decimals. Labels show Ø, R or °; values follow the source on refresh. A projected top/bottom/left/right view uses parentId of a base front view. An auxiliary view adds direction:[x,y,z] (model-space direction toward the viewer, world Z up on paper) to an independent view without a section. A detail view adds detail:{parentId,centerMm,radiusMm,label:"A"} (circle in the parent view sheet mm) with its own originMm and scale; the parent gets the circle and letter. Balloons: {"id":"b1","kind":"balloon","text":"1","positionMm":[120,40],"leaderMm":[100,55]}. Centre marks: {"id":"cm","kind":"center-mark","viewId":"top","atMm":[83.4,60],"positionMm":[83.4,60]} cross the circle or arc nearest atMm. update-view has viewId and changes; remove-view has viewId. Sheets have id,name,widthMm,heightMm,projection:"first_angle"|"third_angle",views:[],annotations:[] and optional titleBlock:[{label,value}] (at most 12 rows, also settable through update-sheet) and optional partsList:{originMm:[x,y],widthMm?} (a BOM table of the source parts: item, part, quantity, material; update-sheet with partsList:null removes it).' } }, ["expected_revision", "command_json"]),
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
      annotations: sheet.sheet.annotations.slice(Number(offset), Number(offset) + 50).map(a => { const built = sheet.annotations.find(p => p.id === a.id); return { ...a, value_mm: built?.valueMm, value_deg: built?.valueDeg, text: built?.text ?? (a.kind === "note" ? a.text : undefined) }; }),
      annotation_count: sheet.sheet.annotations.length, next_offset: Number(offset) + 50 < sheet.sheet.annotations.length ? Number(offset) + 50 : null },
    limits: ["Part sources only; base/projected/principal section/detail/auxiliary views; overall width/height, edge length, diameter, radius, angle, point-to-point and three-point angle dimensions; notes, balloons, centre marks, title-block rows, a parts list (BOM table) of the Part's parts; SVG/DXF/PDF.", "No stepped/isometric sections, cutting-line annotations, assembly sources (the parts list is per Part), ordinate dimensions yet; picks are sheet coordinates."],
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
