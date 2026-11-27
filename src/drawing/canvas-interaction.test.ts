import { describe, expect, it } from "vitest";
import { createEmptyPartDocument } from "@aether/core/document";
import { applyDrawingCommand, createDrawingDocument, type DrawingAnnotation, type DrawingView } from "@aether/core/drawing";
import type { DrawingSheetProjection } from "../core/cad-drawing-bridge";
import {
  buildMoveAnnotationCommand,
  buildMoveViewCommand,
  buildPlacementCommand,
  clampViewBox,
  clientToSheetMm,
  defaultViewBox,
  DRAWING_PLACEMENT_TOOLS,
  findNearestSnapPoint,
  resolveTargetViewId,
  zoomViewBoxAt,
  type DrawingPlacementTool,
} from "./canvas-interaction";

function makeProjection(sheetId: string, viewId: string): DrawingSheetProjection {
  return {
    id: sheetId,
    name: "Sheet 1",
    index: 0,
    width_mm: 297,
    height_mm: 210,
    orientation: "landscape",
    projection_standard: "third_angle",
    default_scale_ratio: 1,
    border: {
      margin_left_mm: 10,
      margin_right_mm: 10,
      margin_top_mm: 10,
      margin_bottom_mm: 10,
      zone_rows: 4,
      zone_columns: 6,
    },
    title_block: {
      id: "tb-1",
      template_id: "iso",
      origin_sheet_mm: [187, 175],
      width_mm: 100,
      height_mm: 25,
      fields: [],
    },
    views: [
      {
        id: viewId,
        name: "Front",
        type_id: "base",
        source: { kind: "part", entity_id: "part-1", configuration_id: null, exploded_state_id: null },
        parent_view_id: null,
        origin_sheet_mm: [100, 100],
        boundary_sheet_mm: [70, 75, 130, 125],
        scale_ratio: 1,
        orientation_model_to_view_quaternion_xyzw: [0, 0, 0, 1],
        label: "Front",
        display: { hidden_lines: "visible", tangent_edges: "visible", show_scale_label: true, show_view_label: true },
        state: "current",
        geometry: {
          geometry_version: 1,
          source_exact_geometry_hash: "h1",
          primitives: [],
          hatch_regions: [],
          snap_points: [
            { snap_id: "snap-corner", kind: "endpoint", point_sheet_mm: [80, 90], primitive_ids: [], source_entity_ids: [], source_topology_ids: [] },
            { snap_id: "snap-mid", kind: "midpoint", point_sheet_mm: [100, 90], primitive_ids: [], source_entity_ids: [], source_topology_ids: [] },
            { snap_id: "snap-hole", kind: "center", point_sheet_mm: [110, 110], primitive_ids: [], source_entity_ids: [], source_topology_ids: [] },
          ],
          bounds_sheet_mm: [70, 75, 130, 125],
        },
        diagnostic_ids: [],
      },
      {
        id: "view-suppressed",
        name: "Hidden",
        type_id: "projected",
        source: { kind: "part", entity_id: "part-1", configuration_id: null, exploded_state_id: null },
        parent_view_id: viewId,
        origin_sheet_mm: [220, 100],
        boundary_sheet_mm: [200, 80, 240, 120],
        scale_ratio: 1,
        orientation_model_to_view_quaternion_xyzw: [0, 0, 0, 1],
        label: "Hidden",
        display: { hidden_lines: "removed", tangent_edges: "removed", show_scale_label: false, show_view_label: false },
        state: "suppressed",
        geometry: {
          geometry_version: 1,
          source_exact_geometry_hash: "h2",
          primitives: [],
          hatch_regions: [],
          snap_points: [
            { snap_id: "snap-suppressed", kind: "endpoint", point_sheet_mm: [80.2, 90.1], primitive_ids: [], source_entity_ids: [], source_topology_ids: [] },
          ],
          bounds_sheet_mm: [200, 80, 240, 120],
        },
        diagnostic_ids: [],
      },
    ],
    annotations: [],
    bom_tables: [],
    layers: [],
    revision: "1",
  };
}

describe("Drawing canvas interaction math & snap lookup", () => {
  it("maps client coordinates into sheet millimeters accurately across zoomed/panned viewBoxes", () => {
    const rect = { left: 50, top: 20, width: 600, height: 400 };
    const full = defaultViewBox(297, 210);
    expect(clientToSheetMm(50, 20, rect, full)).toEqual([0, 0]);
    expect(clientToSheetMm(650, 420, rect, full)).toEqual([297, 210]);

    const zoomed = [50, 40, 150, 100] as const;
    expect(clientToSheetMm(350, 220, rect, zoomed)).toEqual([125, 90]);
  });

  it("zooms smoothly around the cursor anchor point and respects min/max zoom limits", () => {
    const full = defaultViewBox(297, 210);
    const anchor: [number, number] = [120, 80];
    const zoomedIn = zoomViewBoxAt(full, 297, 210, 2, anchor);
    expect(zoomedIn[2]).toBeCloseTo(148.5, 4);
    expect(zoomedIn[3]).toBeCloseTo(105, 4);
    const rxBefore = (anchor[0] - full[0]) / full[2];
    const rxAfter = (anchor[0] - zoomedIn[0]) / zoomedIn[2];
    const ryBefore = (anchor[1] - full[1]) / full[3];
    const ryAfter = (anchor[1] - zoomedIn[1]) / zoomedIn[3];
    expect(rxAfter).toBeCloseTo(rxBefore, 5);
    expect(ryAfter).toBeCloseTo(ryBefore, 5);

    const extremeZoomIn = clampViewBox([0, 0, 1, 1], 297, 210);
    expect(extremeZoomIn[2]).toBeCloseTo(297 / 12, 4);
    const extremeZoomOut = clampViewBox([0, 0, 5000, 5000], 297, 210);
    expect(extremeZoomOut[2]).toBeCloseTo(297 * 2.5, 4);
  });

  it("finds nearest active snap point within radius and ignores suppressed views", () => {
    const proj = makeProjection("sheet-1", "view-front");
    const hit = findNearestSnapPoint(proj, [81.5, 91], 4.5);
    expect(hit).not.toBeNull();
    expect(hit?.snap.snap_id).toBe("snap-corner");
    expect(hit?.viewId).toBe("view-front");

    expect(findNearestSnapPoint(proj, [10, 10], 4.5)).toBeNull();
  });

  it("resolves target view from explicit snap, bounding box hit, or nearest origin", () => {
    const proj = makeProjection("sheet-1", "view-front");
    expect(resolveTargetViewId(proj, [10, 10], "view-custom")).toBe("view-custom");
    expect(resolveTargetViewId(proj, [95, 100])).toBe("view-front");
    expect(resolveTargetViewId(proj, [20, 20])).toBe("view-front");
  });
});

describe("Drawing canvas canonical move and Format-v6 placement commands", () => {
  it("builds valid drag-to-move commands for views and annotations that round-trip through applyDrawingCommand", () => {
    const part = createEmptyPartDocument("Bracket");
    let doc = createDrawingDocument(part, "d1");
    const sheetId = doc.sheets[0].id;
    const view: DrawingView = {
      id: "view-front",
      name: "Front",
      orientation: "front",
      scale: 1,
      originMm: [100, 100],
      hiddenLines: true,
    };
    doc = applyDrawingCommand(doc, { type: "add-view", sheetId, view });
    const note: DrawingAnnotation = { id: "note-1", kind: "note", text: "BREAK EDGES", positionMm: [40, 50] };
    doc = applyDrawingCommand(doc, { type: "add-annotation", sheetId, annotation: note });

    doc = applyDrawingCommand(doc, buildMoveViewCommand(sheetId, view, [12.345, -7.5]));
    expect(doc.sheets[0].views[0].originMm).toEqual([112.35, 92.5]);

    doc = applyDrawingCommand(doc, buildMoveAnnotationCommand(sheetId, note, [8.25, 15.1]));
    expect(doc.sheets[0].annotations[0].positionMm).toEqual([48.25, 65.1]);
  });

  it("builds and applies valid canonical commands for every Format-v6 placement tool", () => {
    const part = createEmptyPartDocument("Housing");
    let doc = createDrawingDocument(part, "d2");
    const sheetId = doc.sheets[0].id;
    const view: DrawingView = {
      id: "view-front",
      name: "Front",
      orientation: "front",
      scale: 1,
      originMm: [100, 100],
      hiddenLines: true,
    };
    doc = applyDrawingCommand(doc, { type: "add-view", sheetId, view });
    const proj = makeProjection(sheetId, view.id);

    const tools = DRAWING_PLACEMENT_TOOLS.filter((t): t is typeof t & { id: Exclude<DrawingPlacementTool, "select"> } => t.id !== "select");
    expect(tools).toHaveLength(12);

    for (const meta of tools) {
      const points: [number, number][] = meta.clicks === 2 ? [[80, 90], [110, 110]] : [[100, 95]];
      const cmd = buildPlacementCommand(doc, proj, meta.id, points, view.id);
      expect(cmd.type).toBe("add-annotation");
      doc = applyDrawingCommand(doc, cmd);
    }

    expect(doc.sheets[0].annotations).toHaveLength(12);
    const kinds = new Set(doc.sheets[0].annotations.map((a) => a.kind));
    for (const meta of tools) {
      expect(kinds.has(meta.id)).toBe(true);
    }

    // Placing a second datum automatically advances label A -> B
    const datum2 = buildPlacementCommand(doc, proj, "datum", [[90, 90]], view.id);
    doc = applyDrawingCommand(doc, datum2);
    const datums = doc.sheets[0].annotations.filter((a) => a.kind === "datum");
    expect(datums.map((d) => d.label)).toEqual(["A", "B"]);
  });
});
