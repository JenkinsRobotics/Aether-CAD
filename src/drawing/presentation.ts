import { Matrix4, Quaternion, Vector3 } from "three";
import { drawingViewFrame, sheetPoint, type BuiltDrawing, type BuiltDrawingView, type ProjectedDrawingCurve } from "@aether/core/drawing";
import type { DrawingPrimitive, DrawingProjectionV1, DrawingStyleProjection, DrawingViewProjection } from "../cad-drawing-bridge";

function primitives(curve: ProjectedDrawingCurve, view: BuiltDrawingView, id: string, hidden: boolean): DrawingPrimitive[] {
  const common = { primitive_id: id, layer_id: hidden ? "hidden" : "visible", visibility_class: hidden ? "hidden" as const : "visible" as const, source_entity_ids: view.geometry.bodyIds, source_topology_ids: [] };
  if (curve.kind === "line") return [{ ...common, kind: "line", start_sheet_mm: sheetPoint(view, curve.start), end_sheet_mm: sheetPoint(view, curve.end) }];
  if (curve.kind === "polyline") return curve.points.slice(1).map((p, i) => ({ ...common, primitive_id: `${id}/${i}`, kind: "line", start_sheet_mm: sheetPoint(view, curve.points[i]), end_sheet_mm: sheetPoint(view, p) }));
  if (curve.kind === "circle") return [{ ...common, kind: "circle", center_sheet_mm: sheetPoint(view, curve.center), radius_mm: curve.radius * view.view.scale }];
  return [{ ...common, kind: "arc", center_sheet_mm: sheetPoint(view, curve.center), radius_mm: curve.radius * view.view.scale, start_angle_rad: -curve.start, end_angle_rad: -curve.end, counterclockwise: curve.ccw }];
}
function viewProjection(built: BuiltDrawing, view: BuiltDrawingView): DrawingViewProjection {
  const frame = drawingViewFrame(view.view.orientation), z = new Vector3(...frame.normal).normalize(), x = new Vector3(...frame.up).cross(z).normalize(), y = z.clone().cross(x);
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z).invert()).toArray() as [number, number, number, number];
  const all = [...(view.geometry.hatch ?? []).flatMap((c, i) => primitives(c, view, `${view.view.id}/hatch/${i}`, false).map(p => ({...p, layer_id: "hatch"}))), ...view.geometry.visible.flatMap((c, i) => primitives(c, view, `${view.view.id}/visible/${i}`, false)), ...(view.view.hiddenLines ? view.geometry.hidden.flatMap((c, i) => primitives(c, view, `${view.view.id}/hidden/${i}`, true)) : [])];
  return {
    id: view.view.id, name: view.view.name, type_id: view.view.section ? "section" : view.view.parentId ? "projected" : "base",
    source: { kind: "part", entity_id: built.document.source.documentId, configuration_id: null, exploded_state_id: null },
    parent_view_id: view.view.parentId ?? null, origin_sheet_mm: view.view.originMm, boundary_sheet_mm: view.boundsMm, scale_ratio: view.view.scale,
    orientation_model_to_view_quaternion_xyzw: quaternion, label: view.view.name,
    display: { hidden_lines: view.view.hiddenLines ? "visible" : "removed", tangent_edges: "removed", show_scale_label: true, show_view_label: true },
    state: "current", diagnostic_ids: [], geometry: { geometry_version: 1, source_exact_geometry_hash: built.sourceHash, primitives: all, hatch_regions: [], snap_points: [], bounds_sheet_mm: view.boundsMm },
  };
}

export function drawingPresentation(built: BuiltDrawing): DrawingProjectionV1 {
  const style = (id: string, dashed = false): DrawingStyleProjection => ({ id, name: id === "hidden" ? "Hidden edges" : id === "hatch" ? "Section hatching" : "Visible edges", line_weight_mm: id === "hatch" ? 0.15 : dashed ? 0.18 : 0.3, line_pattern: dashed ? "dashed" : "solid", dash_pattern_mm: dashed ? [3, 2] : [], color_rgba: [0.12, 0.14, 0.15, 1], text_height_mm: 3.5, font_family: "sans-serif", arrow_size_mm: 2, decimal_places: 2 });
  return {
    schema_version: 1, workspace_id: built.document.documentId, drawing_id: built.document.documentId, name: built.document.name, revision: built.revision, active_sheet_id: built.document.activeSheetId,
    capabilities: { can_edit_sheets: true, supported_view_type_ids: ["base", "projected", "section"], supported_annotation_type_ids: ["note", "linear_dimension"], can_project_hidden_lines: true, can_project_sections: true, can_project_bom: false, can_rebuild: true, can_save_workspace: true, export_format_ids: ["svg", "dxf", "pdf"], unavailable_reasons: [
      { capability_id: "can_project_bom", reason: "Assembly drawings and BOM placement are not connected yet." },
    ] },
    styles: [style("visible"), style("hidden", true), style("hatch")],
    issues: built.approximatedCurveCount ? [{ id: "curve-approximation", severity: "info", code: "display_curve_tolerance", message: `${built.approximatedCurveCount} noncircular curves use 0.01 mm display chords. Overall dimensions use geometric extrema.`, entity_ids: [], field_path: null, recoverable: false }] : [],
    sheets: built.sheets.map(({ sheet, views, annotations }, index) => ({
      id: sheet.id, name: sheet.name, index, width_mm: sheet.widthMm, height_mm: sheet.heightMm, orientation: sheet.widthMm >= sheet.heightMm ? "landscape" : "portrait", projection_standard: sheet.projection, default_scale_ratio: 1,
      border: { margin_left_mm: 10, margin_right_mm: 10, margin_top_mm: 10, margin_bottom_mm: 10, zone_rows: 0, zone_columns: 0 },
      title_block: { id: `${sheet.id}/title`, template_id: "aether-simple", origin_sheet_mm: [sheet.widthMm - 130, sheet.heightMm - 30], width_mm: 120, height_mm: 20, fields: [
        { field_id: "title", label: "Title", value: built.document.name, editable: false },
        { field_id: "units", label: "Units", value: `mm · ${sheet.projection.replace("_", " ")}`, editable: false },
      ] },
      views: views.map(view => viewProjection(built, view)), annotations: annotations.map(annotation => ({
        id: annotation.id, type_id: annotation.valueMm === undefined ? "note" : "linear_dimension", view_id: annotation.viewId ?? null, layer_id: "visible", style_id: "visible", text: annotation.text, text_origin_sheet_mm: annotation.positionMm, text_alignment: annotation.textAlign, leader_points_sheet_mm: [], geometry_lines_sheet_mm: annotation.lines, references: [],
        measurement: annotation.valueMm === undefined ? null : { kind: "length", value_mm: annotation.valueMm, value_rad: null, tolerance_upper_mm: null, tolerance_lower_mm: null, tolerance_upper_rad: null, tolerance_lower_rad: null, display_text: annotation.text, overridden_text: false }, state: "current", diagnostic_ids: [],
      })), bom_tables: [], layers: ["visible", "hidden", "hatch"].map(id => ({ id, name: id, visible: true, printable: true, locked: false, style_id: id })), revision: built.revision,
    })),
  };
}
