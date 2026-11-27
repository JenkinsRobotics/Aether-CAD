import { createRequire } from "node:module";
import React, { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

let dom;
let DrawingSheetCanvas;

const SHEET = {
  id: "sheet-1",
  name: "Sheet 1",
  index: 0,
  width_mm: 297,
  height_mm: 210,
  orientation: "landscape",
  projection_standard: "third_angle",
  default_scale_ratio: 1,
  border: { margin_left_mm: 10, margin_right_mm: 10, margin_top_mm: 10, margin_bottom_mm: 10, zone_rows: 4, zone_columns: 6 },
  title_block: { id: "tb-1", template_id: "iso", origin_sheet_mm: [187, 175], width_mm: 100, height_mm: 25, fields: [] },
  views: [
    {
      id: "view-front",
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
          { snap_id: "s1", kind: "endpoint", point_sheet_mm: [80, 90], primitive_ids: [], source_entity_ids: [], source_topology_ids: [] },
          { snap_id: "s2", kind: "center", point_sheet_mm: [120, 90], primitive_ids: [], source_entity_ids: [], source_topology_ids: [] },
        ],
        bounds_sheet_mm: [70, 75, 130, 125],
      },
      diagnostic_ids: [],
    },
  ],
  annotations: [
    {
      id: "ann-1",
      type_id: "note",
      view_id: "view-front",
      layer_id: "layer-ann",
      style_id: "style-ann",
      text: "NOTE A",
      text_origin_sheet_mm: [40, 40],
      leader_points_sheet_mm: [],
      references: [],
      measurement: null,
      state: "current",
      diagnostic_ids: [],
    },
  ],
  bom_tables: [],
  layers: [],
  revision: "1",
};

beforeAll(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/cad/", pretendToBeVisual: true });
  for (const key of ["window", "document", "navigator", "HTMLElement", "SVGElement", "Element", "Node", "Event", "MouseEvent", "WheelEvent", "KeyboardEvent"]) {
    if (dom.window[key]) vi.stubGlobal(key, dom.window[key]);
  }
  dom.window.PointerEvent = class extends dom.window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = "mouse";
    }
  };
  vi.stubGlobal("PointerEvent", dom.window.PointerEvent);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  DrawingSheetCanvas = (await import("./DrawingSheetCanvas")).DrawingSheetCanvas;
});

afterAll(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function stubSvgRect(svg) {
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 297, height: 210, right: 297, bottom: 210, x: 0, y: 0, toJSON() {} });
  svg.setPointerCapture = vi.fn();
  svg.releasePointerCapture = vi.fn();
}

describe("DrawingSheetCanvas interactive DOM workflows", () => {
  it("zooms via wheel and emits drag-to-move deltas for views and annotations", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onMoveView = vi.fn();
    const onMoveAnnotation = vi.fn();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DrawingSheetCanvas
          sheet={SHEET}
          styles={[]}
          editable
          placementTool="select"
          onMoveView={onMoveView}
          onMoveAnnotation={onMoveAnnotation}
        />,
      );
    });

    const svg = container.querySelector("svg");
    stubSvgRect(svg);
    expect(svg.getAttribute("viewBox")).toBe("0 0 297 210");

    // Wheel zoom in around center
    await act(async () => {
      svg.dispatchEvent(new dom.window.WheelEvent("wheel", { clientX: 148.5, clientY: 105, deltaY: -120, bubbles: true, cancelable: true }));
    });
    const zoomedW = Number(svg.getAttribute("viewBox").split(" ")[2]);
    expect(zoomedW).toBeLessThan(297);

    // Drag a view border handle
    const viewHandle = container.querySelector('[data-view-selector-id="view-front"]');
    await act(async () => {
      viewHandle.dispatchEvent(new dom.window.PointerEvent("pointerdown", { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    });
    await act(async () => {
      svg.dispatchEvent(new dom.window.PointerEvent("pointermove", { clientX: 120, clientY: 110, button: 0, bubbles: true }));
    });
    expect(container.querySelector('[data-drag-preview="view"]')).toBeTruthy();
    await act(async () => {
      svg.dispatchEvent(new dom.window.PointerEvent("pointerup", { clientX: 120, clientY: 110, button: 0, bubbles: true }));
    });
    expect(onMoveView).toHaveBeenCalledTimes(1);
    expect(onMoveView.mock.calls[0][0]).toBe("view-front");

    // Drag an annotation group
    const annGroup = container.querySelector('[data-annotation-id="ann-1"]');
    await act(async () => {
      annGroup.dispatchEvent(new dom.window.PointerEvent("pointerdown", { clientX: 40, clientY: 40, button: 0, bubbles: true }));
    });
    await act(async () => {
      svg.dispatchEvent(new dom.window.PointerEvent("pointermove", { clientX: 55, clientY: 48, button: 0, bubbles: true }));
    });
    await act(async () => {
      svg.dispatchEvent(new dom.window.PointerEvent("pointerup", { clientX: 55, clientY: 48, button: 0, bubbles: true }));
    });
    expect(onMoveAnnotation).toHaveBeenCalledTimes(1);
    expect(onMoveAnnotation.mock.calls[0][0]).toBe("ann-1");

    await act(async () => root.unmount());
  });

  it("snaps 1-click and 2-click placement tools onto projected view snap points", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onPlaceAnnotation = vi.fn();
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);

    // 1-click tool: datum near snap s1 [80, 90]
    await act(async () => {
      root.render(
        <DrawingSheetCanvas
          sheet={SHEET}
          styles={[]}
          editable
          placementTool="datum"
          onPlaceAnnotation={onPlaceAnnotation}
        />,
      );
    });
    const svg = container.querySelector("svg");
    stubSvgRect(svg);

    await act(async () => {
      svg.dispatchEvent(new dom.window.PointerEvent("pointerdown", { clientX: 81.2, clientY: 90.8, button: 0, bubbles: true }));
    });
    expect(onPlaceAnnotation).toHaveBeenCalledWith("datum", [[80, 90]], "view-front");

    // 2-click tool: point-distance snapping s1 [80, 90] -> s2 [120, 90]
    await act(async () => {
      root.render(
        <DrawingSheetCanvas
          sheet={SHEET}
          styles={[]}
          editable
          placementTool="point-distance"
          onPlaceAnnotation={onPlaceAnnotation}
        />,
      );
    });
    stubSvgRect(container.querySelector("svg"));

    await act(async () => {
      svg.dispatchEvent(new dom.window.PointerEvent("pointerdown", { clientX: 80.5, clientY: 90.5, button: 0, bubbles: true }));
    });
    expect(onPlaceAnnotation).toHaveBeenCalledTimes(1);
    await act(async () => {
      svg.dispatchEvent(new dom.window.PointerEvent("pointerdown", { clientX: 119.5, clientY: 90.2, button: 0, bubbles: true }));
    });
    expect(onPlaceAnnotation).toHaveBeenCalledTimes(2);
    expect(onPlaceAnnotation).toHaveBeenLastCalledWith("point-distance", [[80, 90], [120, 90]], "view-front");

    await act(async () => root.unmount());
  });
});
