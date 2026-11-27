/** SolidCraft 0.47 agent/MCP parity toolset: discovery, model queries, exact analysis,
 *  parameter sweep, variables, physical materials, configurations, 3D notes, sketch operations,
 *  and standard parts — all reusing the exact same validated @aether/core document & kernel APIs. */
import type { AgentTool } from "@aether/ui/AgentServices";
import type { AnalysisOptions, AnalysisResult, ImportedModelData } from "@aether/core/contracts";
import {
  activateConfiguration,
  addConfigurationColumn,
  addConfigurationRow,
  addDocumentNote,
  applyFeatureExpressions,
  assignBodyMaterial,
  availableBodies,
  bodyIDForFeature,
  clearBodyMaterial,
  configurationMatches,
  deleteDocumentNote,
  evaluateDocumentVariables,
  evaluateExpression,
  exportPartScript,
  listDocumentNotes,
  materialForBody,
  PHYSICAL_MATERIAL_LIBRARY,
  removeConfigurationRow,
  renameVariable,
  resolveFastenerSeats,
  resolveThreadGeometry,
  safeDeleteVariable,
  setConfigurationValue,
  setVariableComment,
  setVariableFavorite,
  standardPartDocument,
  standardPartLabel,
  standardPartLibrary,
  standardPartVolume,
  updateConfigurationFromDesign,
  updateDocumentNote,
  updatePartDocumentVariables,
  validatePartDocument,
  variableGraph,
  variableUsers,
  type ConfigurationColumn,
  type DocumentVariable,
  type PartDocument,
  type StandardPartFamily,
} from "@aether/core/document";
import {
  breakOffsetAssociation,
  createConstructionLine,
  createEquationCurve,
  createRoundedRectangle,
  createTwoPointCircle,
  divideSketchCurve,
  offsetSketchAdvanced,
  regenerateDimensionExpressions,
  rotateSketchContours,
  scaleSketchContours,
  setSketchCenterline,
  solveDrawingConstraints,
  tieLooseEnds,
  toggleRadiusDiameter,
  type DrawingConstraint,
  type SketchDrawing,
  type SketchEntityRef,
} from "@aether/core/sketch";

const num = { type: "number" };
const str = { type: "string" };
const bool = { type: "boolean" };
const pt3 = { type: "array", items: num, minItems: 3, maxItems: 3 };
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): AgentTool => ({
  name: `aether_cad_${name}`,
  description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
});

export const parityReadToolNames = [
  "aether_cad_commands",
  "aether_cad_describe",
  "aether_cad_model_query",
  "aether_cad_analyze",
  "aether_cad_parameter_sweep",
  "aether_cad_parameters_inspect",
  "aether_cad_material_library",
  "aether_cad_configurations_inspect",
  "aether_cad_notes_inspect",
  "aether_cad_standard_parts",
  "aether_cad_export_script",
] as const;

export const parityEditToolNames = [
  "aether_cad_parameters_edit",
  "aether_cad_material_assign",
  "aether_cad_configuration_edit",
  "aether_cad_notes_edit",
  "aether_cad_sketch_operation",
] as const;

export const parityAgentTools: AgentTool[] = [
  tool(
    "commands",
    "List all available CAD agent commands with short summaries, optionally filtered by keyword query.",
    { query: str },
  ),
  tool(
    "describe",
    "Return the complete JSON input schema and documentation for a single CAD agent command.",
    { name: str },
    ["name"],
  ),
  tool(
    "model_query",
    "Query exact evaluated model geometry or metadata: faces, edges, body_features, threads, or cylindrical fastener_seats.",
    {
      query: { type: "string", enum: ["faces", "edges", "body_features", "threads", "fastener_seats"] },
      body_id: str,
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    ["query"],
  ),
  tool(
    "analyze",
    "Run exact OpenCASCADE engineering analysis on the Part: properties, center_of_mass, classify_points, interference, clearance, compare, section, continuity, curvature_comb, isocurve, or minimum_radius.",
    {
      kind: {
        type: "string",
        enum: [
          "properties",
          "center_of_mass",
          "classify_points",
          "interference",
          "clearance",
          "compare",
          "section",
          "continuity",
          "curvature_comb",
          "isocurve",
          "minimum_radius",
          "silhouette",
          "mesh_inspect",
        ],
      },
      body_ids: { type: "array", items: str, minItems: 1, maxItems: 100 },
      against_body_ids: { type: "array", items: str, minItems: 1, maxItems: 100 },
      density_kg_m3: { type: "number", exclusiveMinimum: 0 },
      points_mm: { type: "array", items: pt3, minItems: 1, maxItems: 500 },
      direction: pt3,
      position_tol_mm: { type: "number", exclusiveMinimum: 0 },
      tangent_tol_deg: { type: "number", exclusiveMinimum: 0 },
      curvature_tol: { type: "number", exclusiveMinimum: 0 },
      clearance_mm: { type: "number", minimum: 0 },
      nearest: { type: "integer", minimum: 1, maximum: 50 },
      plane: { type: "string", enum: ["XY", "XZ", "YZ"] },
      offset_mm: num,
      radius_mm: { type: "number", exclusiveMinimum: 0 },
      count: { type: "integer", minimum: 1, maximum: 100 },
      scale: { type: "number", exclusiveMinimum: 0 },
    },
    ["kind"],
  ),
  tool(
    "parameter_sweep",
    "Evaluate mass, volume, surface area, and bounds across a range of values for one document variable without modifying the Part.",
    {
      variable_name: str,
      from: num,
      to: num,
      steps: { type: "integer", minimum: 2, maximum: 50 },
      density_kg_m3: { type: "number", exclusiveMinimum: 0 },
    },
    ["variable_name", "from", "to", "steps"],
  ),
  tool(
    "parameters_inspect",
    "Inspect all document variables, evaluated SI values, dependency graph, optional users of one variable, or test an expression.",
    { variable_name: str, expression: str },
  ),
  tool(
    "parameters_edit",
    "Edit document variables: set (add/update), rename (rewrites all #references), delete (refuses while used), comment, or favorite.",
    {
      action: { type: "string", enum: ["set", "rename", "delete", "comment", "favorite"] },
      name: str,
      expression: str,
      kind: { type: "string", enum: ["length", "angle", "number", "string"] },
      new_name: str,
      comment: str,
      favorite: bool,
    },
    ["action", "name"],
  ),
  tool(
    "material_library",
    "List built-in engineering materials (density, elastic modulus, Poisson ratio, yield strength) and current body material assignments.",
    { query: str },
  ),
  tool(
    "material_assign",
    "Assign a built-in engineering material (by ID or name) to a body, or clear its material assignment.",
    { body_id: str, material: str, clear: bool },
    ["body_id"],
  ),
  tool(
    "configurations_inspect",
    "Inspect the Part's configuration table: columns, rows, active row, rules, and whether current values match the active row.",
    {},
  ),
  tool(
    "configuration_edit",
    "Manage Part configurations: add_column, add_row, remove_row, set_value, activate, or update_from_design.",
    {
      action: { type: "string", enum: ["add_column", "add_row", "remove_row", "set_value", "activate", "update_from_design"] },
      row_name: str,
      from_row: str,
      column_kind: { type: "string", enum: ["param", "suppress", "material"] },
      column_target: str,
      column_key: str,
      value_string: str,
      value_boolean: bool,
    },
    ["action"],
  ),
  tool(
    "notes_inspect",
    "List persisted 3D viewport notes and PMI annotations stored on the open Part.",
    {},
  ),
  tool(
    "notes_edit",
    "Add, update, resolve, or delete a persisted 3D note / PMI annotation on the open Part.",
    {
      action: { type: "string", enum: ["add", "update", "delete"] },
      note_id: str,
      text: str,
      position_mm: pt3,
      target_body_id: str,
      category: { type: "string", enum: ["note", "pmi", "callout", "review"] },
      resolved: bool,
    },
    ["action"],
  ),
  tool(
    "sketch_operation",
    "Apply an advanced sketch authoring or solver operation to an existing drawing sketch: construction_line, rounded_rectangle, two_point_circle, equation_curve, divide_curve, set_centerline, toggle_diameter, tie_loose_ends, offset_advanced, break_offset, or add_constraint.",
    {
      feature_id: str,
      action: {
        type: "string",
        enum: [
          "construction_line",
          "rounded_rectangle",
          "two_point_circle",
          "equation_curve",
          "divide_curve",
          "set_centerline",
          "toggle_diameter",
          "tie_loose_ends",
          "offset_advanced",
          "break_offset",
          "rotate_contours",
          "scale_contours",
          "add_constraint",
        ],
      },
      params_json: str,
    },
    ["feature_id", "action"],
  ),
  tool(
    "standard_parts",
    "Query the ISO metric (M2–M30) and ASME inch UNC standard parts catalogue, or compute specs and volume for a specific fastener/bearing.",
    {
      family: str,
      size: str,
      length_mm: { type: "number", exclusiveMinimum: 0 },
    },
  ),
  tool(
    "export_script",
    "Export the open Part's complete parametric timeline, variables, materials, rules, and configurations as a runnable TypeScript build script.",
    {},
  ),
];

type Args = Record<string, unknown>;

export function handleParityReadTool(
  allTools: readonly AgentTool[],
  doc: PartDocument | null,
  name: string,
  args: Args,
): unknown {
  if (name === "aether_cad_commands") {
    const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const filtered = allTools.filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    return {
      changed: false,
      total: filtered.length,
      commands: filtered.map((t) => ({ name: t.name, summary: t.description.split(".")[0] + "." })),
    };
  }
  if (name === "aether_cad_describe") {
    const found = allTools.find((t) => t.name === args.name);
    if (!found) throw new Error(`Unknown command "${String(args.name)}". Call aether_cad_commands to list available tools.`);
    return { changed: false, command: found };
  }
  if (name === "aether_cad_standard_parts") {
    const family = typeof args.family === "string" ? (args.family as StandardPartFamily) : undefined;
    if (family && typeof args.size === "string") {
      const req = { family, size: args.size, ...(typeof args.length_mm === "number" ? { length: args.length_mm } : {}) };
      const generated = standardPartDocument(req);
      return {
        changed: false,
        label: standardPartLabel(req),
        volume_mm3: standardPartVolume(req),
        estimated_steel_mass_kg: standardPartVolume(req) * 7850e-9,
        feature_count: generated.features.length,
      };
    }
    return { changed: false, families: standardPartLibrary(family) };
  }
  if (!doc) throw new Error("Create or open a Part first.");
  if (name === "aether_cad_parameters_inspect") {
    const variables = doc.variables ?? [];
    const evaluated = evaluateDocumentVariables(variables);
    const evaluatedMap: Record<string, unknown> = {};
    for (const [k, v] of evaluated) evaluatedMap[k] = v;
    const users = typeof args.variable_name === "string" ? variableUsers(doc, args.variable_name) : undefined;
    const exprResult = typeof args.expression === "string"
      ? evaluateExpression(args.expression, {
          resolveVariable: (varName) => {
            const found = evaluated.get(varName);
            if (found === undefined) throw new Error(`Unknown variable #${varName}.`);
            return found;
          },
        })
      : undefined;
    return {
      changed: false,
      variables,
      evaluated: evaluatedMap,
      graph: variableGraph(doc),
      ...(users ? { users } : {}),
      ...(exprResult ? { expression_result: exprResult } : {}),
    };
  }
  if (name === "aether_cad_material_library") {
    const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const library = PHYSICAL_MATERIAL_LIBRARY.filter(
      (m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q),
    );
    const assignments = availableBodies(doc).map((b) => ({
      body_id: b.id,
      body_name: b.name,
      material: materialForBody(doc, b.id) ?? null,
    }));
    return { changed: false, total: library.length, library, assignments };
  }
  if (name === "aether_cad_configurations_inspect") {
    const table = doc.configurations ?? { columns: [], rows: [] };
    return {
      changed: false,
      columns: table.columns,
      rows: table.rows,
      active_row: table.activeRow ?? null,
      matches_active: table.activeRow ? configurationMatches(doc, table.activeRow) : null,
      rules: table.rules ?? [],
    };
  }
  if (name === "aether_cad_notes_inspect") {
    const notes = listDocumentNotes(doc);
    return { changed: false, total: notes.length, notes };
  }
  if (name === "aether_cad_export_script") {
    const script = exportPartScript(doc);
    return { changed: false, language: "typescript", feature_count: doc.features.length, script };
  }
  throw new Error(`Unsupported read tool: ${name}`);
}

export function handleModelQuery(doc: PartDocument, model: ImportedModelData, args: Args): unknown {
  const query = String(args.query);
  const bodyFilter = typeof args.body_id === "string" ? args.body_id : undefined;
  const offset = typeof args.offset === "number" ? args.offset : 0;
  const limit = typeof args.limit === "number" ? args.limit : 50;
  const parts = bodyFilter ? model.parts.filter((p) => p.id === bodyFilter) : model.parts;
  if (bodyFilter && !parts.length) throw new Error(`Body "${bodyFilter}" not found.`);

  if (query === "faces") {
    const faces = parts.flatMap((p) =>
      p.topology.map((f) => ({
        body_id: p.id,
        face_id: f.id,
        surface_type: f.surfaceType,
        measurements: f.measurements ?? null,
        candidate_count: f.candidates.length,
      })),
    );
    return { changed: false, total: faces.length, faces: faces.slice(offset, offset + limit), next_offset: offset + limit < faces.length ? offset + limit : null };
  }
  if (query === "edges") {
    const edges = parts.flatMap((p) =>
      p.topology.flatMap((f) =>
        f.candidates
          .filter((c) => c.kind === "edge-midpoint" || c.kind === "circle-center")
          .map((c) => ({
            body_id: p.id,
            face_id: f.id,
            candidate_id: c.id,
            kind: c.kind,
            label: c.label,
            origin_mm: c.origin,
            measurements: c.measurements ?? null,
          })),
      ),
    );
    return { changed: false, total: edges.length, edges: edges.slice(offset, offset + limit), next_offset: offset + limit < edges.length ? offset + limit : null };
  }
  if (query === "body_features") {
    const bodies = availableBodies(doc)
      .filter((b) => !bodyFilter || b.id === bodyFilter)
      .map((b) => ({
        body_id: b.id,
        name: b.name,
        contributing_features: doc.features
          .filter((f) => !f.suppressed && (bodyIDForFeature(doc, f) === b.id || ("targetBodyId" in f && f.targetBodyId === b.id)))
          .map((f) => ({ id: f.id, name: f.name, type: f.type })),
      }));
    return { changed: false, bodies };
  }
  if (query === "threads") {
    const threads = doc.features
      .filter((f) => f.type === "thread" && !f.suppressed)
      .map((f) => {
        if (f.type !== "thread") return null;
        return { id: f.id, name: f.name, ...resolveThreadGeometry(f), modeled: Boolean(f.modeled), body_id: f.targetBodyId ?? f.face.bodyId };
      })
      .filter(Boolean);
    return { changed: false, total: threads.length, threads };
  }
  if (query === "fastener_seats") {
    const seats = parts.flatMap((p) => resolveFastenerSeats(p.topology).map((s) => ({ body_id: p.id, ...s })));
    return { changed: false, total: seats.length, seats };
  }
  throw new Error(`Unknown model query "${query}".`);
}

export function buildAnalysisOptions(args: Args): AnalysisOptions {
  return {
    kind: args.kind as AnalysisOptions["kind"],
    ...(Array.isArray(args.body_ids) ? { bodyIds: args.body_ids as string[] } : {}),
    ...(Array.isArray(args.against_body_ids) ? { againstBodyIds: args.against_body_ids as string[] } : {}),
    ...(typeof args.density_kg_m3 === "number" ? { density_kg_m3: args.density_kg_m3 } : {}),
    ...(Array.isArray(args.points_mm) ? { points_mm: args.points_mm as [number, number, number][] } : {}),
    ...(Array.isArray(args.direction) ? { direction: args.direction as [number, number, number] } : {}),
    ...(typeof args.position_tol_mm === "number" ? { position_tol_mm: args.position_tol_mm } : {}),
    ...(typeof args.tangent_tol_deg === "number" ? { tangent_tol_deg: args.tangent_tol_deg } : {}),
    ...(typeof args.curvature_tol === "number" ? { curvature_tol: args.curvature_tol } : {}),
    ...(typeof args.clearance_mm === "number" ? { clearance_mm: args.clearance_mm } : {}),
    ...(typeof args.nearest === "number" ? { nearest: args.nearest } : {}),
    ...(typeof args.plane === "string" ? { plane: args.plane as "XY" | "XZ" | "YZ" } : {}),
    ...(typeof args.offset_mm === "number" ? { offset_mm: args.offset_mm } : {}),
    ...(typeof args.radius_mm === "number" ? { radius_mm: args.radius_mm } : {}),
    ...(typeof args.count === "number" ? { count: args.count } : {}),
    ...(typeof args.scale === "number" ? { scale: args.scale } : {}),
  };
}

export async function runAgentParameterSweep(
  doc: PartDocument,
  args: Args,
  analyzeFn: (candidate: PartDocument, options: AnalysisOptions) => Promise<AnalysisResult>,
): Promise<unknown> {
  const varName = String(args.variable_name);
  const from = Number(args.from), to = Number(args.to), steps = Number(args.steps);
  const density = typeof args.density_kg_m3 === "number" ? args.density_kg_m3 : undefined;
  const existing = (doc.variables ?? []).find((v) => v.name === varName);
  if (!existing) throw new Error(`Variable "#${varName}" does not exist.`);
  const unitSuffix = existing.kind === "length" ? " mm" : existing.kind === "angle" ? " deg" : "";
  const results = [];
  for (let i = 0; i < steps; i++) {
    const val = from + ((to - from) * i) / (steps - 1);
    const expr = `${Number(val.toFixed(6))}${unitSuffix}`;
    try {
      const nextVars = (doc.variables ?? []).map((v) => (v.name === varName ? { ...v, expression: expr } : v));
      const updated = await updatePartDocumentVariables(doc, nextVars);
      const propRes = await analyzeFn(updated, { kind: "properties", ...(density ? { density_kg_m3: density } : {}) });
      const volumeMm3 = propRes.measurements.reduce((s, m) => s + Number(m.volume_mm3 ?? 0), 0);
      const areaMm2 = propRes.measurements.reduce((s, m) => s + Number(m.area_mm2 ?? 0), 0);
      const massKg = propRes.measurements.reduce((s, m) => s + Number(m.mass_kg ?? 0), 0);
      results.push({ step: i, value: val, expression: expr, ok: true, volume_mm3: volumeMm3, area_mm2: areaMm2, mass_kg: massKg });
    } catch (err) {
      results.push({ step: i, value: val, expression: expr, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { changed: false, variable_name: varName, steps: results };
}

function applyVariablesSync(source: PartDocument, variables: readonly DocumentVariable[]): PartDocument {
  const next = structuredClone(source);
  next.variables = structuredClone([...variables]);
  const resolved = evaluateDocumentVariables(next.variables);
  applyFeatureExpressions(next, resolved);
  for (const feat of next.features) {
    if (feat.type === "profile" && feat.profile.type === "drawing" && feat.profile.constraints?.some((c) => c.valueExpression !== undefined)) {
      feat.profile = regenerateDimensionExpressions(feat.profile, resolved);
    }
  }
  return next;
}

export function prepareParityEdit(doc: PartDocument, name: string, args: Args): { document: PartDocument; featureID: string } {
  if (name === "aether_cad_parameters_edit") {
    const action = String(args.action);
    const varName = String(args.name);
    let next: PartDocument;
    if (action === "set") {
      if (typeof args.expression !== "string" || !args.expression.trim()) throw new Error("set requires a non-empty expression.");
      const existing = doc.variables ?? [];
      const idx = existing.findIndex((v) => v.name === varName);
      const kind = (args.kind ?? existing[idx]?.kind ?? "length") as DocumentVariable["kind"];
      const updatedVar: DocumentVariable = {
        ...(idx >= 0 ? existing[idx] : {}),
        name: varName,
        expression: args.expression.trim(),
        kind,
        ...(typeof args.comment === "string" ? { comment: args.comment } : {}),
        ...(typeof args.favorite === "boolean" ? { favorite: args.favorite } : {}),
      };
      const vars = idx >= 0 ? existing.map((v, i) => (i === idx ? updatedVar : v)) : [...existing, updatedVar];
      next = applyVariablesSync(doc, vars);
    } else if (action === "rename") {
      if (typeof args.new_name !== "string" || !args.new_name.trim()) throw new Error("rename requires new_name.");
      next = renameVariable(doc, varName, args.new_name.trim());
    } else if (action === "delete") {
      next = safeDeleteVariable(doc, varName);
    } else if (action === "comment") {
      next = setVariableComment(doc, varName, typeof args.comment === "string" ? args.comment : "");
    } else if (action === "favorite") {
      next = setVariableFavorite(doc, varName, args.favorite !== false);
    } else {
      throw new Error(`Unknown parameters_edit action "${action}".`);
    }
    validatePartDocument(next);
    return { document: next, featureID: `var:${varName}` };
  }

  if (name === "aether_cad_material_assign") {
    const bodyId = String(args.body_id);
    const next = args.clear ? clearBodyMaterial(doc, bodyId) : assignBodyMaterial(doc, bodyId, String(args.material ?? ""));
    validatePartDocument(next);
    return { document: next, featureID: `material:${bodyId}` };
  }

  if (name === "aether_cad_configuration_edit") {
    const action = String(args.action);
    let next: PartDocument;
    if (action === "add_column") {
      const kind = String(args.column_kind ?? "");
      const target = String(args.column_target ?? "");
      const col: ConfigurationColumn =
        kind === "param" ? { kind: "param", name: target }
        : kind === "suppress" ? { kind: "suppress", featureId: target }
        : kind === "material" ? { kind: "material", bodyId: target }
        : (() => { throw new Error("column_kind must be param, suppress, or material."); })();
      next = addConfigurationColumn(doc, col);
    } else if (action === "add_row") {
      next = addConfigurationRow(doc, String(args.row_name ?? ""), typeof args.from_row === "string" ? args.from_row : undefined);
    } else if (action === "remove_row") {
      next = removeConfigurationRow(doc, String(args.row_name ?? ""));
    } else if (action === "set_value") {
      const val = args.value_boolean !== undefined ? Boolean(args.value_boolean) : String(args.value_string ?? "");
      next = setConfigurationValue(doc, String(args.row_name ?? ""), String(args.column_key ?? ""), val);
    } else if (action === "activate") {
      const activated = activateConfiguration(doc, String(args.row_name ?? "")).document;
      next = applyVariablesSync(activated, activated.variables ?? []);
    } else if (action === "update_from_design") {
      next = updateConfigurationFromDesign(doc, typeof args.row_name === "string" ? args.row_name : undefined);
    } else {
      throw new Error(`Unknown configuration_edit action "${action}".`);
    }
    validatePartDocument(next);
    return { document: next, featureID: `config:${String(args.row_name ?? action)}` };
  }

  if (name === "aether_cad_notes_edit") {
    const action = String(args.action);
    let next: PartDocument;
    let noteId = typeof args.note_id === "string" ? args.note_id : "";
    if (action === "add") {
      if (typeof args.text !== "string" || !args.text.trim()) throw new Error("add note requires text.");
      const res = addDocumentNote(doc, {
        ...(noteId ? { id: noteId } : {}),
        text: args.text,
        ...(Array.isArray(args.position_mm) ? { positionMillimeters: args.position_mm as [number, number, number] } : {}),
        ...(typeof args.target_body_id === "string" ? { targetBodyId: args.target_body_id } : {}),
        ...(typeof args.category === "string" ? { category: args.category as "note" | "pmi" | "callout" | "review" } : {}),
        ...(typeof args.resolved === "boolean" ? { resolved: args.resolved } : {}),
      });
      next = res.document;
      noteId = res.note.id;
    } else if (action === "update") {
      if (!noteId) throw new Error("update note requires note_id.");
      next = updateDocumentNote(doc, noteId, {
        ...(typeof args.text === "string" ? { text: args.text } : {}),
        ...(Array.isArray(args.position_mm) ? { positionMillimeters: args.position_mm as [number, number, number] } : {}),
        ...(typeof args.category === "string" ? { category: args.category as "note" | "pmi" | "callout" | "review" } : {}),
        ...(typeof args.resolved === "boolean" ? { resolved: args.resolved } : {}),
      });
    } else if (action === "delete") {
      if (!noteId) throw new Error("delete note requires note_id.");
      next = deleteDocumentNote(doc, noteId);
    } else {
      throw new Error(`Unknown notes_edit action "${action}".`);
    }
    validatePartDocument(next);
    return { document: next, featureID: noteId };
  }

  if (name === "aether_cad_sketch_operation") {
    const featureId = String(args.feature_id);
    const action = String(args.action);
    const params: Record<string, unknown> = typeof args.params_json === "string" ? JSON.parse(args.params_json) : {};
    const next = structuredClone(doc);
    const feat = next.features.find((f) => f.id === featureId);
    if (!feat || feat.type !== "profile" || feat.profile.type !== "drawing") {
      throw new Error("sketch_operation requires an existing drawing ProfileFeature.");
    }
    let drawing: SketchDrawing = feat.profile;

    if (action === "construction_line") {
      drawing = createConstructionLine(drawing, params as unknown as Parameters<typeof createConstructionLine>[1]).drawing;
    } else if (action === "rounded_rectangle") {
      const contour = createRoundedRectangle(
        params.cornerA as [number, number],
        params.cornerB as [number, number],
        Number(params.filletRadius ?? 2),
        Boolean(params.construction),
      );
      drawing = { ...drawing, contours: [...drawing.contours, contour] };
    } else if (action === "two_point_circle") {
      const contour = createTwoPointCircle(params.a as [number, number], params.b as [number, number], Boolean(params.construction));
      drawing = { ...drawing, contours: [...drawing.contours, contour] };
    } else if (action === "equation_curve") {
      const vars = evaluateDocumentVariables(next.variables ?? []);
      const contour = createEquationCurve({
        ...(params as unknown as Parameters<typeof createEquationCurve>[0]),
        variables: vars,
      });
      drawing = { ...drawing, contours: [...drawing.contours, contour] };
    } else if (action === "divide_curve") {
      const curveRef: SketchEntityRef = (params.curve as SketchEntityRef) ?? {
        contour: Number(params.contourIndex),
        kind: "segment",
        index: Number(params.segmentIndex ?? 0),
      };
      drawing = divideSketchCurve(drawing, curveRef, Number(params.count ?? 2)).drawing;
    } else if (action === "set_centerline") {
      const indices = Array.isArray(params.contourIndices) ? params.contourIndices.map(Number) : [Number(params.contourIndex)];
      drawing = setSketchCenterline(drawing, indices, params.enabled !== false);
    } else if (action === "toggle_diameter") {
      drawing = toggleRadiusDiameter(drawing, String(params.constraintId));
    } else if (action === "tie_loose_ends") {
      drawing = tieLooseEnds(drawing, typeof params.toleranceMm === "number" ? params.toleranceMm : undefined).drawing;
    } else if (action === "offset_advanced") {
      const indices = Array.isArray(params.contourIndices) ? params.contourIndices.map(Number) : [Number(params.contourIndex)];
      drawing = offsetSketchAdvanced(drawing, indices, params as unknown as Parameters<typeof offsetSketchAdvanced>[2]);
    } else if (action === "break_offset") {
      const indices = Array.isArray(params.contourIndices)
        ? params.contourIndices.map(Number)
        : params.contourIndex !== undefined
          ? [Number(params.contourIndex)]
          : undefined;
      drawing = breakOffsetAssociation(drawing, indices).drawing;
    } else if (action === "rotate_contours") {
      const indices = Array.isArray(params.contourIndices) ? params.contourIndices.map(Number) : drawing.contours.map((_, i) => i);
      const center = (Array.isArray(params.center) ? params.center : [0, 0]) as [number, number];
      drawing = rotateSketchContours(drawing, indices, center, Number(params.angleDegrees ?? 0), { adaptFixed: Boolean(params.adaptFixed) }).drawing;
    } else if (action === "scale_contours") {
      const indices = Array.isArray(params.contourIndices) ? params.contourIndices.map(Number) : drawing.contours.map((_, i) => i);
      const center = (Array.isArray(params.center) ? params.center : [0, 0]) as [number, number];
      drawing = scaleSketchContours(drawing, indices, center, Number(params.factor ?? 1), { adaptFixed: Boolean(params.adaptFixed) }).drawing;
    } else if (action === "add_constraint") {
      const constraint = params as unknown as DrawingConstraint;
      const withConstraint: SketchDrawing = { ...drawing, constraints: [...(drawing.constraints ?? []), constraint] };
      drawing = solveDrawingConstraints(withConstraint);
    } else {
      throw new Error(`Unknown sketch_operation action "${action}".`);
    }

    feat.profile = drawing;
    validatePartDocument(next);
    return { document: next, featureID: featureId };
  }

  throw new Error(`Unknown parity edit tool "${name}".`);
}
