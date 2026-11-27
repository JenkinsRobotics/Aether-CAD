import { openCADFeatureWindow } from "./features/feature-window-style";
import { unitChoice, parseQuantity } from "@aether/core/units";
import { documentUnits } from "../app/document-preferences";
import { renderPhysicalProperties } from "./properties";
import { availableBodies, type PartDocument } from "@aether/core/document";
import type { ImportedModelData } from "@aether/core/contracts";
import { onEngine } from "../core/engine/evaluate-part";
import { analyzeOnAether, measureOnAether } from "../core/engine/aether/evaluator";
import type { MeasureReference } from "../viewport/measure/measure-reference";
import "../ui/CADPopups.css";

let closeActive: (() => void) | undefined;
type Kind =
  | "section"
  | "interference"
  | "properties"
  | "clearance"
  | "compare"
  | "continuity"
  | "curvature_comb"
  | "isocurve"
  | "minimum_radius"
  | "silhouette"
  | "mesh_inspect";
const CURVE_KINDS: readonly Kind[] = ["continuity", "curvature_comb", "isocurve", "minimum_radius", "silhouette"];
type CurveOverlay = { label: string; color: string; polylines: [number, number, number][][] };
/** The engine answers with measurements and, for sections and interference, meshes to show. */
type AnalysisAnswer = { status: "ok"; measurements: Record<string, unknown>[]; parts?: ImportedModelData["parts"]; curves?: CurveOverlay[] };

export async function analyzePart(
  doc: PartDocument,
  analysis: {
    kind: Kind | "distance" | "intersection_curve" | "isoparametric_curve" | "project_curve" | "mesh_convert";
    bodyIds?: string[];
    plane?: string;
    offset_mm?: number;
    reverse?: boolean;
    density_kg_m3?: number;
    entities?: readonly object[];
    count?: number;
    scale?: number;
    radius_mm?: number;
    uv?: "u" | "v";
    polylines?: [number, number, number][][];
    direction?: [number, number, number];
  },
  signal?: AbortSignal,
) {
  void signal;
  if (analysis.kind === "distance") {
    return onEngine<AnalysisAnswer>({
      aether: async () => measureOnAether(doc, (analysis.entities ?? []) as MeasureReference[]) as unknown as AnalysisAnswer,
    });
  }
  const { kind, plane, offset_mm, reverse, density_kg_m3, count, scale, radius_mm, uv, polylines, direction, bodyIds } = analysis;
  return onEngine<AnalysisAnswer>({
    aether: () =>
      analyzeOnAether(doc, {
        kind,
        plane: plane as "XY" | "XZ" | "YZ" | undefined,
        offset_mm,
        reverse,
        density_kg_m3,
        count,
        scale,
        radius_mm,
        uv,
        polylines,
        direction,
        bodyIds,
        entities: analysis.entities as MeasureReference[] | undefined,
      }),
  });
}

function analysisTitle(kind: Kind): string {
  switch (kind) {
    case "clearance": return "Clearance";
    case "compare": return "Compare bodies";
    case "section": return "Section view";
    case "properties": return "Physical properties";
    case "continuity": return "Continuity";
    case "curvature_comb": return "Curvature comb";
    case "isocurve": return "Isocurves";
    case "minimum_radius": return "Minimum radius";
    case "silhouette": return "Silhouette / parting";
    case "mesh_inspect": return "Mesh inspect";
    default: return "Interference";
  }
}

function buildAnalysisTable(
  labels: string[],
  rows: (string | { text: string; tone?: "ok" | "warn" | "error"; numeric?: boolean })[][],
  numericColumns: ReadonlySet<number> = new Set(),
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "cad-analysis-table";
  const header = table.createTHead().insertRow();
  labels.forEach((label, index) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    if (numericColumns.has(index)) cell.dataset.numeric = "true";
    header.append(cell);
  });
  const body = table.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    values.forEach((entry, index) => {
      const cell = row.insertCell();
      const text = typeof entry === "string" ? entry : entry.text;
      const numeric = typeof entry === "object" ? entry.numeric : numericColumns.has(index);
      if (numeric) cell.dataset.numeric = "true";
      if (typeof entry === "object" && entry.tone) {
        const badge = document.createElement("span");
        badge.className = "cad-analysis-badge";
        badge.dataset.tone = entry.tone;
        badge.textContent = text;
        cell.append(badge);
      } else {
        cell.textContent = text;
      }
    });
  }
  return table;
}

export function openPartAnalysis(
  kind: Kind,
  doc: PartDocument | null,
  show: (model: ImportedModelData | null) => void,
  showCurves: (curves: CurveOverlay[]) => void = () => undefined,
  selection: () => readonly MeasureReference[] = () => [],
) {
  if (document.querySelector(".cad-feature-dialog")) throw Error("Finish or cancel the feature editor before analysis.");
  closeActive?.();
  if (!doc) throw Error("Open a Part first.");
  const snapshot = structuredClone(doc);
  const units = structuredClone(documentUnits());
  const lengthUnit = unitChoice(units, "length");
  const densityUnit = unitChoice(units, "density");
  const names = new Map(availableBodies(snapshot).map((b) => [b.id, b.name]));
  let closed = false, revision = 0;
  let controller: AbortController | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("aether-feature-preview-start", close);
    revision++;
    controller?.abort();
    show(null);
    showCurves([]);
    window.removeEventListener("aether-part-updated", close);
    win.close();
  };
  const win = openCADFeatureWindow({
    className: "cad-analysis-dialog",
    icon: "inspect",
    viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body,
    title: analysisTitle(kind),
    acceptLabel: "Done",
    onAccept: close,
    onDiscard: close,
  });
  closeActive = close;
  const status = document.createElement("p");
  status.className = "cad-analysis-status";
  status.setAttribute("role", "status");

  const plane = document.createElement("select");
  plane.setAttribute("aria-label", "Section plane");
  for (const value of ["XY", "XZ", "YZ"]) plane.add(new Option(value, value));
  const offset = document.createElement("input");
  offset.type = "number";
  offset.value = "0";
  offset.setAttribute("aria-label", `Section offset (${lengthUnit.unit})`);
  const reverse = document.createElement("input");
  reverse.type = "checkbox";
  reverse.setAttribute("aria-label", "Keep opposite side");

  const density = document.createElement("input");
  density.type = "number";
  density.placeholder = "Optional";
  density.setAttribute("aria-label", `Density (${densityUnit.unit})`);

  const count = document.createElement("input");
  count.type = "number";
  count.min = "1";
  count.value = kind === "isocurve" ? "8" : "48";
  count.setAttribute("aria-label", kind === "isocurve" ? "Curves each way" : "Samples per edge");

  const scale = document.createElement("input");
  scale.type = "number";
  scale.placeholder = "Auto";
  scale.setAttribute("aria-label", "Tooth scale (mm per 1/mm)");

  const threshold = document.createElement("input");
  threshold.type = "number";
  threshold.placeholder = "Optional";
  threshold.setAttribute("aria-label", `Flag radii below (${lengthUnit.unit})`);

  const pullAxis = document.createElement("select");
  pullAxis.setAttribute("aria-label", "Pull direction");
  for (const [label, value] of [["+Z (Top)", "0,0,1"], ["+Y (Back)", "0,1,0"], ["+X (Right)", "1,0,0"]] as const) {
    pullAxis.add(new Option(label, value));
  }

  if (kind === "section" || kind === "properties" || kind === "isocurve" || kind === "curvature_comb" || kind === "minimum_radius" || kind === "silhouette") {
    const params = win.section("Parameters");
    if (kind === "section") {
      params.body.append(win.row("Plane", plane), win.row(`Offset (${lengthUnit.unit})`, offset), win.row("Keep opposite side", reverse));
    }
    if (kind === "properties") {
      params.body.append(win.row(`Density (${densityUnit.unit})`, density));
    }
    if (kind === "isocurve") {
      params.body.append(win.row("Curves each way", count));
    }
    if (kind === "curvature_comb") {
      params.body.append(win.row("Samples per edge", count), win.row("Tooth scale", scale));
    }
    if (kind === "minimum_radius") {
      params.body.append(win.row(`Flag below (${lengthUnit.unit})`, threshold));
    }
    if (kind === "silhouette") {
      params.body.append(win.row("Pull direction", pullAxis));
    }
  }

  const resultsSection = win.section("Results");
  const measurements = document.createElement("div");
  measurements.className = "cad-analysis-results";
  resultsSection.body.append(status, measurements);

  const update = async () => {
    const ticket = ++revision;
    controller?.abort();
    controller = new AbortController();
    show(null);
    showCurves([]);
    measurements.replaceChildren();
    status.textContent = "Computing exact solid geometry…";
    try {
      if (!offset.value.trim() || !Number.isFinite(Number(offset.value))) throw Error("Enter a finite section offset.");
      const densityValue = density.value.trim() ? parseQuantity(density.value, units, "density") : undefined;
      if (kind === "properties" && densityValue !== undefined && (!Number.isFinite(densityValue) || densityValue <= 0)) {
        throw Error(`Density must be positive, in ${densityUnit.unit}.`);
      }
      const picked = CURVE_KINDS.includes(kind) ? selection() : [];
      const result = await analyzePart(
        snapshot,
        {
          kind,
          ...(densityValue !== undefined ? { density_kg_m3: densityValue } : {}),
          ...(picked.length ? { entities: picked } : {}),
          count: Number(count.value) || undefined,
          scale: scale.value.trim() ? Number(scale.value) : undefined,
          radius_mm: threshold.value.trim() ? parseQuantity(threshold.value, units, "length") * 1000 : undefined,
          plane: plane.value,
          offset_mm: parseQuantity(offset.value, units, "length") * 1000,
          reverse: reverse.checked,
          ...(kind === "silhouette" ? { direction: pullAxis.value.split(",").map(Number) as [number, number, number] } : {}),
        },
        controller.signal,
      );
      if (closed || ticket !== revision) return;

      if (kind === "properties") {
        status.textContent =
          densityValue === undefined
            ? "Exact geometry. Assigned body materials supply density automatically, or enter an override above."
            : "Uniform density applied to each body. Inertia is about each center of mass, in world axes.";
        measurements.append(renderPhysicalProperties(result.measurements as unknown as Parameters<typeof renderPhysicalProperties>[0], names, units));
        return;
      }

      if (kind === "mesh_inspect") {
        const items = result.measurements as Array<{
          body_id: string;
          vertex_count: number;
          triangle_count: number;
          surface_area_mm2: number;
          signed_volume_mm3: number;
          boundary_edge_count: number;
          non_manifold_edge_count: number;
          watertight: boolean;
        }>;
        const allTight = items.every((m) => m.watertight);
        status.textContent = items.length
          ? `${items.length} bod${items.length === 1 ? "y" : "ies"} inspected · ${allTight ? "All meshes watertight." : "Open or non-manifold edges detected."}`
          : "No bodies or meshes available to inspect.";
        const mmPerUnit = lengthUnit.factor * 1000;
        for (const item of items) {
          const card = document.createElement("div");
          card.className = "cad-analysis-card";
          const h4 = document.createElement("h4");
          h4.textContent = names.get(item.body_id) ?? item.body_id;
          card.append(
            h4,
            buildAnalysisTable(
              ["Metric", "Value"],
              [
                ["Status", { text: item.watertight ? "Watertight" : "Open / Non-manifold", tone: item.watertight ? "ok" : "error" }],
                ["Vertices", String(item.vertex_count.toLocaleString())],
                ["Triangles", String(item.triangle_count.toLocaleString())],
                [`Area (${lengthUnit.unit}²)`, (item.surface_area_mm2 / mmPerUnit ** 2).toFixed(lengthUnit.decimals)],
                [`Signed volume (${lengthUnit.unit}³)`, (item.signed_volume_mm3 / mmPerUnit ** 3).toFixed(lengthUnit.decimals)],
                ["Boundary edges", { text: String(item.boundary_edge_count), tone: item.boundary_edge_count === 0 ? "ok" : "warn" }],
                ["Non-manifold edges", { text: String(item.non_manifold_edge_count), tone: item.non_manifold_edge_count === 0 ? "ok" : "error" }],
              ],
              new Set([1]),
            ),
          );
          measurements.append(card);
        }
        return;
      }

      if (kind === "silhouette") {
        showCurves(result.curves ?? []);
        const items = result.measurements as Array<{ body_id: string; width_mm: number; height_mm: number; projected_area_mm2: number; silhouette_curve_count: number }>;
        const mmPerUnit = lengthUnit.factor * 1000;
        status.textContent = items.length
          ? `${items.length} bod${items.length === 1 ? "y" : "ies"} projected · silhouette curves drawn in viewport.`
          : "No solid bodies available for silhouette analysis.";
        if (items.length) {
          const card = document.createElement("div");
          card.className = "cad-analysis-card";
          card.append(
            buildAnalysisTable(
              ["Body", `Bounds (${lengthUnit.unit})`, `Area (${lengthUnit.unit}²)`, "Curves"],
              items.map((m) => [
                names.get(m.body_id) ?? m.body_id,
                `${(m.width_mm / mmPerUnit).toFixed(lengthUnit.decimals)} × ${(m.height_mm / mmPerUnit).toFixed(lengthUnit.decimals)}`,
                (m.projected_area_mm2 / mmPerUnit ** 2).toFixed(lengthUnit.decimals),
                String(m.silhouette_curve_count),
              ]),
              new Set([2, 3]),
            ),
          );
          measurements.append(card);
        }
        return;
      }

      if (CURVE_KINDS.includes(kind)) {
        showCurves(result.curves ?? []);
        const pickedCount = selection().length;
        const scope = pickedCount ? `${pickedCount} selected ${pickedCount === 1 ? "entity" : "entities"}` : "every body";
        const continuity = result.measurements.filter((m) => typeof m.continuity === "string") as { continuity: string }[];
        const overall = result.measurements.find((m) => "overall_min_radius_mm" in m) as { overall_min_radius_mm: number } | undefined;
        status.textContent =
          kind === "continuity"
            ? `${continuity.length} edges on ${scope}: ${["G0", "G1", "G2"].map((g) => `${continuity.filter((m) => m.continuity === g).length} ${g}`).join(", ")}.`
            : kind === "minimum_radius"
              ? overall
                ? `Smallest radius ${(overall.overall_min_radius_mm / (lengthUnit.factor * 1000)).toFixed(lengthUnit.decimals)} ${lengthUnit.unit} on ${scope}, marked in the viewport.`
                : `No curved face or edge on ${scope}.`
              : kind === "isocurve"
                ? `${result.curves?.reduce((n, c) => n + c.polylines.length, 0) ?? 0} isoparametric curves on ${scope}.`
                : `Curvature comb on ${scope}: tooth length is curvature × scale.`;
        const rows = (result.measurements.filter((m) => "body_id" in m) as Record<string, unknown>[]).slice(0, 200).map((m) => {
          const entity = `${names.get(String(m.body_id)) ?? m.body_id}${m.face_id !== undefined ? ` · face ${m.face_id}` : ""}${m.edge_index !== undefined ? ` · edge ${m.edge_index}` : ""}`;
          if (kind === "continuity") {
            const g = String(m.continuity);
            const tone: "ok" | "warn" | "error" = g === "G2" ? "ok" : g === "G1" ? "warn" : "error";
            return [entity, { text: g, tone }];
          }
          if (kind === "isocurve") return [entity, String(m.surface ?? "")];
          return [entity, typeof m.min_radius_mm === "number" ? (m.min_radius_mm / (lengthUnit.factor * 1000)).toFixed(lengthUnit.decimals) : "straight"];
        });
        const card = document.createElement("div");
        card.className = "cad-analysis-card";
        card.append(
          buildAnalysisTable(
            ["Entity", kind === "continuity" ? "Continuity" : kind === "isocurve" ? "Surface" : `Min radius (${lengthUnit.unit})`],
            rows,
            new Set(kind === "minimum_radius" ? [1] : []),
          ),
        );
        measurements.append(card);
        return;
      }

      const parts = result.parts ?? [];
      show({ sourceName: snapshot.name, parts, parseMilliseconds: 0 });
      status.textContent =
        kind === "section"
          ? `Capped section · ${parts.length} bodies remain. Close to restore the complete model.`
          : kind === "clearance"
            ? `${result.measurements.length} body pairs measured. Zero means they touch or overlap.`
            : kind === "compare"
              ? (result.measurements[0] as { identical?: boolean } | undefined)?.identical
                ? "The two bodies are the same solid. Nothing differs."
                : "The bodies differ. What is only in one or the other is shown in the viewport."
              : result.measurements.length
                ? `${result.measurements.length} interfering body pairs. Overlap geometry is shown in the viewport.`
                : "No solid-volume interference. Touching faces are not an overlap.";

      const cubic = (v: number) => (v / (lengthUnit.factor * 1000) ** 3).toFixed(lengthUnit.decimals);
      if (kind === "clearance" && result.measurements.length) {
        const card = document.createElement("div");
        card.className = "cad-analysis-card";
        card.append(
          buildAnalysisTable(
            ["Body", "Body", `Distance (${lengthUnit.unit})`],
            (result.measurements as { first_body_id: string; second_body_id: string; distance_mm: number; overlapping: boolean }[]).map((m) => [
              names.get(m.first_body_id) ?? m.first_body_id,
              names.get(m.second_body_id) ?? m.second_body_id,
              m.overlapping
                ? { text: "0 (overlap)", tone: "error", numeric: true }
                : (m.distance_mm / (lengthUnit.factor * 1000)).toFixed(lengthUnit.decimals),
            ]),
            new Set([2]),
          ),
        );
        measurements.append(card);
      }
      if (kind === "compare" && result.measurements.length) {
        const m = result.measurements[0] as { first_body_id: string; second_body_id: string; only_in_first_mm3: number; only_in_second_mm3: number; common_mm3: number };
        const card = document.createElement("div");
        card.className = "cad-analysis-card";
        card.append(
          buildAnalysisTable(
            ["Region", `Volume (${lengthUnit.unit}³)`],
            [
              [`Only in ${names.get(m.first_body_id) ?? m.first_body_id}`, cubic(m.only_in_first_mm3)],
              [`Only in ${names.get(m.second_body_id) ?? m.second_body_id}`, cubic(m.only_in_second_mm3)],
              ["Shared", cubic(m.common_mm3)],
            ],
            new Set([1]),
          ),
        );
        measurements.append(card);
      }
      if (kind === "interference" && result.measurements.length) {
        const card = document.createElement("div");
        card.className = "cad-analysis-card";
        card.append(
          buildAnalysisTable(
            ["Body", "Body", `Volume (${lengthUnit.unit}³)`],
            (result.measurements as { first_body_id: string; second_body_id: string; volume_mm3: number }[]).map((item) => [
              names.get(item.first_body_id) ?? item.first_body_id,
              names.get(item.second_body_id) ?? item.second_body_id,
              { text: cubic(item.volume_mm3), tone: "error", numeric: true },
            ]),
            new Set([2]),
          ),
        );
        measurements.append(card);
      }
    } catch (error) {
      if (!closed && ticket === revision) status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  for (const control of [plane, offset, reverse, density, count, scale, threshold, pullAxis]) {
    control.addEventListener("change", () => void update());
  }
  window.addEventListener("aether-part-updated", close);
  window.addEventListener("aether-feature-preview-start", close);
  void update();
}
