import { describe, expect, it } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
import { cadCommandIDs, isCADCommandID } from "../core/cad-command-registry";
import { featureEditor } from "../modeling/features";
import { cadRibbonWorkspace } from "../ui/cad-tool-catalog";
import { cadReadOnlyInteraction } from "../ai/read-only-tools";
import { buildAnalysisOptions, handleParityReadTool, parityAgentTools } from "./parity-tools";
import { buildCADDrawingPresentation } from "../core/cad-drawing-presentation";
import type { DrawingProjectionV1 } from "../core/cad-drawing-bridge";

describe("SolidCraft 0.47 Pass 3 parity — UI editors, ribbon wiring, agent tools, and drawing actions", () => {
  it("registers all new Pass 3 feature editors, commands, and framing/surface/sheet/solid ribbon tools", () => {
    const editorTypes = [
      "primitive",
      "bounding-solid",
      "surface-match",
      "surface-fillet",
      "sheet-convert",
      "sheet-path-flange",
      "frame-trim",
      "frame-gusset",
    ];
    for (const type of editorTypes) {
      expect(featureEditor(type), `editor ${type}`).toBeDefined();
      expect(isCADCommandID(`feature-${type}`), `command feature-${type}`).toBe(true);
    }
    expect(cadCommandIDs).toContain("part-silhouette");
    expect(cadCommandIDs).toContain("export-part-script");

    // Framing tab now has ZERO greyed-out buttons!
    const framingTools = cadRibbonWorkspace("framing").groups.flatMap((g) => g.tools);
    expect(framingTools.every((t) => Boolean(t.action))).toBe(true);
    expect(framingTools.find((t) => t.id === "framing-trim")?.action).toBe("feature-frame-trim");
    expect(framingTools.find((t) => t.id === "framing-gusset")?.action).toBe("feature-frame-gusset");

    // Surface Modify includes Match & Surface Fillet
    const surfaceModify = cadRibbonWorkspace("surface").groups.find((g) => g.id === "surface-modify")!.tools;
    expect(surfaceModify.some((t) => t.action === "feature-surface-match")).toBe(true);
    expect(surfaceModify.some((t) => t.action === "feature-surface-fillet")).toBe(true);

    // Sheet Metal Create includes Convert to sheet & Contour flange
    const sheetCreate = cadRibbonWorkspace("sheet-metal").groups.find((g) => g.id === "sheet-create")!.tools;
    expect(sheetCreate.some((t) => t.action === "feature-sheet-convert")).toBe(true);
    expect(sheetCreate.some((t) => t.action === "feature-sheet-path-flange")).toBe(true);
  });

  it("exposes aether_cad_export_script as read-only and passes silhouette/continuity analysis parameters", () => {
    const readOnly = cadReadOnlyInteraction({ tools: parityAgentTools } as never);
    expect(readOnly.readOnlyTools).toContain("aether_cad_export_script");

    const doc = createRectanglePartDocument("Bracket", { widthMillimeters: 50, heightMillimeters: 30, depthMillimeters: 5 });
    const exported = handleParityReadTool(parityAgentTools, doc, "aether_cad_export_script", {}) as {
      changed: boolean;
      language: string;
      feature_count: number;
      script: string;
    };
    expect(exported.changed).toBe(false);
    expect(exported.language).toBe("typescript");
    expect(exported.feature_count).toBe(2);
    expect(exported.script).toContain("export function buildPart()");

    const opts = buildAnalysisOptions({
      kind: "silhouette",
      direction: [0, 0, 1],
      position_tol_mm: 0.002,
      tangent_tol_deg: 0.25,
      curvature_tol: 0.005,
    });
    expect(opts).toMatchObject({
      kind: "silhouette",
      direction: [0, 0, 1],
      position_tol_mm: 0.002,
      tangent_tol_deg: 0.25,
      curvature_tol: 0.005,
    });
  });

  it("exposes Standard 4-View, Import Dimensions, and Audit Drawing commands in Drawing presentation", () => {
    const projection: DrawingProjectionV1 = {
      schema_version: 1,
      workspace_id: "ws-1",
      revision: "r1",
      drawing_id: "dwg-1",
      name: "Test Drawing",
      capabilities: {
        can_edit_sheets: true,
        supported_view_type_ids: ["base", "projected", "section"],
        supported_annotation_type_ids: ["linear_dimension", "note"],
        can_project_hidden_lines: true,
        can_project_sections: true,
        can_project_bom: true,
        can_rebuild: true,
        can_save_workspace: true,
        export_format_ids: ["pdf", "dxf", "svg"],
        unavailable_reasons: [],
      },
      active_sheet_id: null,
      sheets: [],
      styles: [],
      issues: [],
    };
    const presentation = buildCADDrawingPresentation(projection, null);
    for (const id of ["add-standard-views", "import-dimensions", "audit-drawing"] as const) {
      expect(presentation.commandAvailability.find((c) => c.id === id)?.enabled).toBe(true);
    }
  });
});
