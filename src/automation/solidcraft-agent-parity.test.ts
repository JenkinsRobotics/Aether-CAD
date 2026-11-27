import { describe, expect, it, vi } from "vitest";
import { availableBodies, createRectanglePartDocument, type PartDocument, type PartFeature } from "@aether/core/document";
import type { ImportedModelData } from "@aether/core/contracts";
import { CADAgentEditor, type CADAgentWorkspace } from "./live-workspace";
import { cadAgentTools } from "./live-commands";
import { drawingAgentInteraction, drawingAgentTools } from "./drawing-agent";
import { DrawingEditor } from "../drawing/controller";
import { CADDrawingWorkspaceStore } from "../core/stores/cad-drawing-workspace-store";
import { cadReadOnlyInteraction } from "../ai/read-only-tools";
import { validateToolArguments } from "./tool-arguments";

function makePartFixture() {
  let doc: PartDocument = createRectanglePartDocument("Bracket", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
  const bodyId = availableBodies(doc)[0].id;
  const model: ImportedModelData = {
    sourceName: "Bracket",
    parseMilliseconds: 2,
    parts: [
      {
        id: bodyId,
        name: "Body 1",
        sourceDocumentId: doc.documentId,
        sourceName: doc.name,
        vertices: new Float32Array(),
        normals: new Float32Array(),
        triangles: new Uint32Array(),
        edgeLines: new Float32Array(),
        faceRanges: [],
        topology: [
          {
            id: 1,
            surfaceType: "CYLINDER",
            measurements: { radiusMillimeters: 3.2, areaSquareMillimeters: 2 * Math.PI * 3.2 * 10 },
            candidates: [
              { id: "c1", faceId: 1, kind: "cylinder-axis", label: "M6 Bore", origin: [0, 0, 5], xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], measurements: { radiusMillimeters: 3.2 } },
            ],
          },
        ],
      },
    ],
  };
  const workspace: CADAgentWorkspace = {
    current: () => doc,
    contextKey: () => "part1",
    available: () => true,
    writable: () => true,
    evaluate: vi.fn(async () => model),
    analyze: vi.fn(async (candidate, options) => ({
      status: "ok" as const,
      kind: options.kind,
      bodies: [],
      measurements: [{ body_id: bodyId, volume_mm3: 8000 * (candidate.variables?.length ? 1.5 : 1), area_mm2: 2800, mass_kg: 0.0216 }],
    })),
    commit: vi.fn((next) => { doc = next; }),
    history: { candidate: () => null, commit: vi.fn() },
  };
  const editor = new CADAgentEditor(workspace);
  const call = (name: string, args: Record<string, unknown> = {}) =>
    editor.execute("part1", { id: "c", name: `aether_cad_${name}`, arguments: args }, new AbortController().signal);
  return { workspace, editor, call, current: () => doc, bodyId };
}

describe("SolidCraft 0.47 Parity — Agent & MCP Command Surface", () => {
  it("validates every new tool schema cleanly and classifies read-only vs editing tools accurately", () => {
    for (const t of [...cadAgentTools, ...drawingAgentTools]) {
      // Trigger schema keyword check on every published tool
      expect(() => validateToolArguments([t], t.name, { __bogus_key_xyz: 1 })).toThrow(/Unknown argument|missing required/);
    }
    const ro = cadReadOnlyInteraction({ contextKey: "test", tools: [...cadAgentTools, ...drawingAgentTools], execute: async () => ({}) });
    for (const expectedRO of [
      "aether_cad_commands", "aether_cad_describe", "aether_cad_model_query", "aether_cad_analyze",
      "aether_cad_parameter_sweep", "aether_cad_parameters_inspect", "aether_cad_material_library",
      "aether_cad_configurations_inspect", "aether_cad_notes_inspect", "aether_cad_standard_parts",
      "aether_cad_drawing_audit", "aether_cad_drawing_hit_test",
    ]) {
      expect(ro.readOnlyTools).toContain(expectedRO);
    }
    for (const expectedWrite of [
      "aether_cad_parameters_edit", "aether_cad_material_assign", "aether_cad_configuration_edit",
      "aether_cad_notes_edit", "aether_cad_sketch_operation",
    ]) {
      expect(ro.readOnlyTools).not.toContain(expectedWrite);
    }
  });

  it("supports commands/describe discovery, model_query, analyze, parameter_sweep, and standard_parts", async () => {
    const { call, bodyId } = makePartFixture();
    const cmds = (await call("commands", { query: "material" })) as any;
    expect(cmds.commands.some((c: any) => c.name === "aether_cad_material_library")).toBe(true);

    const desc = (await call("describe", { name: "aether_cad_analyze" })) as any;
    expect(desc.command.inputSchema.required).toEqual(["kind"]);

    const seats = (await call("model_query", { query: "fastener_seats", body_id: bodyId })) as any;
    expect(seats.seats).toHaveLength(1);
    expect(seats.seats[0].recommendedMetricSize).toBe("M6");

    const faces = (await call("model_query", { query: "faces" })) as any;
    expect(faces.total).toBe(1);

    const analysis = (await call("analyze", { kind: "center_of_mass", density_kg_m3: 2700 })) as any;
    expect(analysis.status).toBe("ok");
    expect(analysis.measurements[0].mass_kg).toBeCloseTo(0.0216, 4);

    const std = (await call("standard_parts", { family: "asme_socket_screw", size: "1/4-20", length_mm: 25.4 })) as any;
    expect(std.label).toContain("ASME B18.3");
    expect(std.volume_mm3).toBeGreaterThan(700);
  });

  it("edits parameters, materials, configurations, 3D notes, and sketch operations atomically", async () => {
    const { call, current, bodyId } = makePartFixture();

    // Parameters CRUD + parameter sweep
    await call("parameters_edit", { action: "set", name: "width", expression: "40 mm", kind: "length", comment: "Main span", favorite: true });
    const pInspect = (await call("parameters_inspect", { variable_name: "width", expression: "#width * 2" })) as any;
    expect(pInspect.variables[0].name).toBe("width");
    expect(pInspect.expression_result.magnitudeSI).toBeCloseTo(0.08, 6);

    const sweep = (await call("parameter_sweep", { variable_name: "width", from: 20, to: 60, steps: 3 })) as any;
    expect(sweep.steps).toHaveLength(3);
    expect(sweep.steps.every((s: any) => s.ok)).toBe(true);

    await call("parameters_edit", { action: "rename", name: "width", new_name: "span" });
    expect(current().variables?.[0].name).toBe("span");

    // Material assign + library inspect
    await call("material_assign", { body_id: bodyId, material: "6061-T6" });
    const mats = (await call("material_library", { query: "6061" })) as any;
    expect(mats.library.length).toBeGreaterThanOrEqual(1);
    expect(mats.assignments[0].material.name).toContain("6061");

    // Configurations CRUD
    await call("configuration_edit", { action: "add_column", column_kind: "param", column_target: "span" });
    await call("configuration_edit", { action: "add_row", row_name: "Standard" });
    await call("configuration_edit", { action: "add_row", row_name: "Wide", from_row: "Standard" });
    await call("configuration_edit", { action: "set_value", row_name: "Wide", column_key: "param:span", value_string: "80 mm" });
    await call("configuration_edit", { action: "activate", row_name: "Wide" });
    const cfg = (await call("configurations_inspect")) as any;
    expect(cfg.active_row).toBe("Wide");
    expect(current().variables?.[0].expression).toBe("80 mm");

    // 3D Notes CRUD
    const addedNote = (await call("notes_edit", { action: "add", text: "Deburr edges", position_mm: [10, 5, 10], category: "pmi" })) as any;
    expect(addedNote.changed).toBe(true);
    const notesList = (await call("notes_inspect")) as any;
    expect(notesList.total).toBe(1);
    expect(notesList.notes[0].category).toBe("pmi");

    // Sketch operation on a drawing profile
    const drawFeat: PartFeature = {
      id: "sk-draw",
      type: "profile",
      name: "DrawSketch",
      plane: "XY",
      offsetMillimeters: 0,
      suppressed: false,
      profile: { type: "drawing", contours: [] },
    };
    current().features.push(drawFeat);
    await call("sketch_operation", {
      feature_id: "sk-draw",
      action: "rounded_rectangle",
      params_json: JSON.stringify({ cornerA: [0, 0], cornerB: [30, 20], filletRadius: 3 }),
    });
    const skInspect = (await call("sketch_inspect", { feature_id: "sk-draw" })) as any;
    expect(skInspect.profile.total_contours).toBe(1);
    expect(skInspect.profile.diagnostics).toBeDefined();
    expect(skInspect.profile.loose_ends).toBeDefined();
  });

  it("supports drawing audit, hit-testing, and format-v6 annotations through the Drawing agent", async () => {
    const editor = new DrawingEditor(new CADDrawingWorkspaceStore(), async () => ({
      visible: [
        { kind: "line" as const, start: [-20, -10], end: [20, -10] },
        { kind: "circle" as const, center: [0, 0], radius: 5 },
      ],
      hidden: [],
      bounds: [-20, -10, 20, 10],
      bodyIds: ["body"],
    }));
    editor.configure(() => createRectanglePartDocument("Plate", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 }));
    await editor.enter();
    const interaction = drawingAgentInteraction(editor, "dwg", () => "dwg");
    const call = (name: string, args: Record<string, unknown> = {}) =>
      interaction.execute({ id: "c", name: `aether_cad_${name}`, arguments: args }, new AbortController().signal);

    const sheetId = editor.snapshot()!.document.activeSheetId;
    await call("drawing_edit", {
      expected_revision: editor.snapshot()!.revision,
      command_json: JSON.stringify({ type: "add-view", sheetId, view: { id: "v1", name: "Front", orientation: "front", originMm: [100, 100], scale: 1, hiddenLines: true } }),
    });
    await call("drawing_edit", {
      expected_revision: editor.snapshot()!.revision,
      command_json: JSON.stringify({ type: "add-annotation", sheetId, annotation: { id: "gdt-1", kind: "gdt", viewId: "v1", characteristic: "flatness", tolerance: "0.02", positionMm: [130, 90] } }),
    });

    const audit = (await call("drawing_audit")) as any;
    expect(audit.ok).toBe(true);
    expect(audit.templates.length).toBeGreaterThanOrEqual(7);

    const hit = (await call("drawing_hit_test", { point_mm: [100, 100], radius_mm: 3 })) as any;
    expect(hit.hits.some((h: any) => h.kind === "snap" && h.viewId === "v1")).toBe(true);
  });
});
