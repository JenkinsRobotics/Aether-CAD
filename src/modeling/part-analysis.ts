import { openCADFeatureWindow } from "../features/feature-window-style";
import {unitChoice, parseQuantity} from "@aether/core/units";
import {documentUnits} from "../document-preferences";
import {renderPhysicalProperties} from "./properties";
import { availableBodies, type PartDocument } from "@aether/core/document";
import type { ImportedModelData } from "@aether/core/contracts";
import { onEngine } from "../engine/evaluate-part";
import { analyzeOnAether, measureOnAether } from "../engine/aether/evaluator";
import type { MeasureReference } from "../measure/measure-reference";

let closeActive: (() => void) | undefined;
type Kind = "section" | "interference" | "properties" | "clearance" | "compare" | "continuity" | "curvature_comb" | "isocurve" | "minimum_radius";
const CURVE_KINDS: readonly Kind[] = ["continuity", "curvature_comb", "isocurve", "minimum_radius"];
type CurveOverlay = { label: string; color: string; polylines: [number, number, number][][] };
/** The engine answers with measurements and, for sections and interference, meshes to show. */
type AnalysisAnswer = { status: "ok"; measurements: Record<string, unknown>[]; parts?: ImportedModelData["parts"]; curves?: CurveOverlay[] };
export async function analyzePart(doc: PartDocument, analysis: { kind: Kind | "distance" | "intersection_curve" | "isoparametric_curve" | "project_curve" | "mesh_convert"; bodyIds?: string[]; plane?: string; offset_mm?: number; reverse?: boolean; density_kg_m3?: number; entities?: readonly object[]; count?: number; scale?: number; radius_mm?: number; uv?: "u" | "v"; polylines?: [number, number, number][][]; direction?: [number, number, number] }, signal?: AbortSignal) {
  void signal;
  if (analysis.kind === "distance") return onEngine<AnalysisAnswer>({ aether: async () => measureOnAether(doc, (analysis.entities ?? []) as MeasureReference[]) as unknown as AnalysisAnswer });
  const { kind, plane, offset_mm, reverse, density_kg_m3, count, scale, radius_mm, uv, polylines, direction, bodyIds } = analysis;
  return onEngine<AnalysisAnswer>({ aether: () => analyzeOnAether(doc, { kind, plane: plane as "XY" | "XZ" | "YZ" | undefined, offset_mm, reverse, density_kg_m3, count, scale, radius_mm, uv, polylines, direction, bodyIds, entities: analysis.entities as MeasureReference[] | undefined }) });
}


export function openPartAnalysis(kind: Kind, doc: PartDocument | null, show: (model: ImportedModelData | null) => void, showCurves: (curves: CurveOverlay[]) => void = () => undefined, selection: () => readonly MeasureReference[] = () => []) {
  if (document.querySelector(".cad-feature-dialog")) throw Error("Finish or cancel the feature editor before analysis.");
  closeActive?.();
  if (!doc) throw Error("Open a Part first.");
  const snapshot = structuredClone(doc);
  const units = structuredClone(documentUnits());
  const lengthUnit = unitChoice(units,"length");
  const densityUnit = unitChoice(units,"density");
  const names = new Map(availableBodies(snapshot).map(b => [b.id, b.name]));
  let closed = false, revision = 0;
  let controller: AbortController | undefined;
  const close = () => { if (closed) return; closed = true; window.removeEventListener("aether-feature-preview-start", close); revision++; controller?.abort(); show(null); showCurves([]); window.removeEventListener("aether-part-updated", close); win.close(); };
  const win = openCADFeatureWindow({ className: "cad-analysis-dialog", icon: "inspect", viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body, title: kind === "clearance" ? "Clearance" : kind === "compare" ? "Compare bodies" : kind === "section" ? "Section view" : kind === "properties" ? "Physical properties" : kind === "continuity" ? "Continuity" : kind === "curvature_comb" ? "Curvature comb" : kind === "isocurve" ? "Isocurves" : kind === "minimum_radius" ? "Minimum radius" : "Interference", acceptLabel: "Done", onAccept: close, onDiscard: close });
  closeActive = close;
  const status = document.createElement("p"); status.className = "cad-analysis-status"; status.setAttribute("role", "status");
  const plane = document.createElement("select"); plane.setAttribute("aria-label", "Section plane");
  for (const value of ["XY", "XZ", "YZ"]) plane.add(new Option(value, value));
  const offset = document.createElement("input"); offset.type = "number"; offset.value = "0"; offset.setAttribute("aria-label", `Section offset (${lengthUnit.unit})`);
  const reverse = document.createElement("input"); reverse.type = "checkbox"; reverse.setAttribute("aria-label", "Keep opposite side");
  if (kind === "section") { win.row("Plane", plane); win.row(`Offset (${lengthUnit.unit})`, offset); win.row("Keep opposite side", reverse); }
  const density = document.createElement("input"); density.type = "number"; density.placeholder = "Optional"; density.setAttribute("aria-label", `Density (${densityUnit.unit})`);
  if (kind === "properties") win.row(`Density (${densityUnit.unit})`, density);
  const count = document.createElement("input"); count.type = "number"; count.min = "1"; count.value = kind === "isocurve" ? "8" : "48"; count.setAttribute("aria-label", kind === "isocurve" ? "Curves each way" : "Samples per edge");
  const scale = document.createElement("input"); scale.type = "number"; scale.placeholder = "Auto"; scale.setAttribute("aria-label", "Tooth scale (mm per 1/mm)");
  const threshold = document.createElement("input"); threshold.type = "number"; threshold.placeholder = "Optional"; threshold.setAttribute("aria-label", `Flag radii below (${lengthUnit.unit})`);
  if (kind === "isocurve") win.row("Curves each way", count);
  if (kind === "curvature_comb") { win.row("Samples per edge", count); win.row("Tooth scale", scale); }
  if (kind === "minimum_radius") win.row(`Flag below (${lengthUnit.unit})`, threshold);
  status.style.fontSize = "0.8rem";
  const measurements = document.createElement("div");
  measurements.style.maxHeight = "40vh"; measurements.style.overflowY = "auto";
  measurements.style.fontSize = "0.8rem";
  win.body.append(status, measurements);
  const update = async () => {
    const ticket = ++revision; controller?.abort(); controller = new AbortController(); show(null); showCurves([]); measurements.replaceChildren(); status.textContent = "Computing exact solid geometry…";
    try {
      if (!offset.value.trim() || !Number.isFinite(Number(offset.value))) throw Error("Enter a finite section offset.");
      const densityValue = density.value.trim() ? parseQuantity(density.value,units,"density") : undefined;
      if (kind === "properties" && densityValue !== undefined && (!Number.isFinite(densityValue) || densityValue <= 0)) throw Error(`Density must be positive, in ${densityUnit.unit}.`);
      const picked = CURVE_KINDS.includes(kind) ? selection() : [];
      const result = await analyzePart(snapshot, { kind, ...(densityValue !== undefined ? {density_kg_m3:densityValue} : {}), ...(picked.length ? { entities: picked } : {}), count: Number(count.value) || undefined, scale: scale.value.trim() ? Number(scale.value) : undefined, radius_mm: threshold.value.trim() ? parseQuantity(threshold.value,units,"length")*1000 : undefined, plane: plane.value, offset_mm: parseQuantity(offset.value,units,"length")*1000, reverse: reverse.checked }, controller.signal);
      if (closed || ticket !== revision) return;
      if (kind === "properties") {
        status.textContent = densityValue === undefined ? "Exact geometry. Enter density to calculate mass and inertia." : "Uniform density applied to each body. Inertia is about each center of mass, in world axes.";
        measurements.append(renderPhysicalProperties(result.measurements as unknown as Parameters<typeof renderPhysicalProperties>[0],names,units));
        return;
      }
      if (CURVE_KINDS.includes(kind)) {
        showCurves(result.curves ?? []);
        const picked = selection().length;
        const scope = picked ? `${picked} selected ${picked === 1 ? "entity" : "entities"}` : "every body";
        const continuity = result.measurements.filter((m) => typeof m.continuity === "string") as { continuity: string }[];
        const overall = result.measurements.find((m) => "overall_min_radius_mm" in m) as { overall_min_radius_mm: number } | undefined;
        status.textContent = kind === "continuity" ? `${continuity.length} edges on ${scope}: ${["G0", "G1", "G2"].map((g) => `${continuity.filter((m) => m.continuity === g).length} ${g}`).join(", ")}. Red G0 (position only), amber G1 (tangent), green G2 (curvature).`
          : kind === "minimum_radius" ? (overall ? `Smallest radius ${(overall.overall_min_radius_mm / (lengthUnit.factor * 1000)).toFixed(lengthUnit.decimals)} ${lengthUnit.unit} on ${scope}, marked in the viewport.` : `No curved face or edge on ${scope}.`)
          : kind === "isocurve" ? `${result.curves?.reduce((n, c) => n + c.polylines.length, 0) ?? 0} isoparametric curves on ${scope}. Trimmed faces show the curves of their whole surface.`
          : `Curvature comb on ${scope}: tooth length is curvature × scale; the amber envelope joins the tips.`;
        const rows = (result.measurements.filter((m) => "body_id" in m) as Record<string, unknown>[]).map((m) => [
          `${names.get(String(m.body_id)) ?? m.body_id}${m.face_id !== undefined ? ` · face ${m.face_id}` : ""}${m.edge_index !== undefined ? ` · edge ${m.edge_index}` : ""}`,
          kind === "continuity" ? String(m.continuity) : kind === "isocurve" ? String(m.surface ?? "") : typeof m.min_radius_mm === "number" ? (m.min_radius_mm / (lengthUnit.factor * 1000)).toFixed(lengthUnit.decimals) : "straight",
        ]);
        const table = document.createElement("table"); table.style.width = "100%";
        const header = table.createTHead().insertRow();
        for (const label of ["Entity", kind === "continuity" ? "Continuity" : kind === "isocurve" ? "Surface" : `Min radius (${lengthUnit.unit})`]) { const cell = document.createElement("th"); cell.textContent = label; cell.style.textAlign = "left"; header.append(cell); }
        const body = table.createTBody();
        for (const values of rows.slice(0, 200)) { const row = body.insertRow(); for (const text of values) row.insertCell().textContent = text; }
        measurements.append(table);
        return;
      }
      const parts = result.parts ?? [];
      show({ sourceName: snapshot.name, parts, parseMilliseconds: 0 });
      status.textContent = kind === "section"
        ? `Capped section · ${parts.length} bodies remain. Close to restore the complete model.`
        : kind === "clearance" ? `${result.measurements.length} body pairs measured. Zero means they touch or overlap.`
        : kind === "compare" ? ((result.measurements[0] as { identical?: boolean } | undefined)?.identical ? "The two bodies are the same solid. Nothing differs." : "The bodies differ. What is only in one or the other is shown in the viewport.")
        : result.measurements.length ? `${result.measurements.length} interfering body pairs. Overlap geometry is shown in the viewport.` : "No solid-volume interference. Touching faces are not an overlap.";
      const cubic = (v: number) => (v / (lengthUnit.factor * 1000) ** 3).toFixed(lengthUnit.decimals);
      const tableOf = (labels: string[], rows: string[][]) => {
        const table = document.createElement("table"); table.style.width = "100%";
        const header = table.createTHead().insertRow();
        for (const label of labels) { const cell = document.createElement("th"); cell.textContent = label; cell.style.textAlign = "left"; header.append(cell); }
        const body = table.createTBody();
        for (const values of rows) { const row = body.insertRow(); for (const text of values) row.insertCell().textContent = text; }
        return table;
      };
      if (kind === "clearance") measurements.append(tableOf(["Body", "Body", `Distance (${lengthUnit.unit})`], (result.measurements as { first_body_id: string; second_body_id: string; distance_mm: number; overlapping: boolean }[]).map((m) => [names.get(m.first_body_id) ?? m.first_body_id, names.get(m.second_body_id) ?? m.second_body_id, m.overlapping ? "0 (overlap)" : (m.distance_mm / (lengthUnit.factor * 1000)).toFixed(lengthUnit.decimals)])));
      if (kind === "compare" && result.measurements.length) {
        const m = result.measurements[0] as { first_body_id: string; second_body_id: string; only_in_first_mm3: number; only_in_second_mm3: number; common_mm3: number };
        measurements.append(tableOf(["", `Volume (${lengthUnit.unit}³)`], [[`Only in ${names.get(m.first_body_id) ?? m.first_body_id}`, cubic(m.only_in_first_mm3)], [`Only in ${names.get(m.second_body_id) ?? m.second_body_id}`, cubic(m.only_in_second_mm3)], ["Shared", cubic(m.common_mm3)]]));
      }
      if (kind === "interference" && result.measurements.length) {
        const table = document.createElement("table"); table.style.width = "100%";
        const header = table.createTHead().insertRow();
        for (const label of ["Body", "Body", `Volume (${lengthUnit.unit}³)`]) { const cell = document.createElement("th"); cell.textContent = label; cell.style.textAlign = "left"; header.append(cell); }
        const body = table.createTBody();
        for (const item of result.measurements as { first_body_id: string; second_body_id: string; volume_mm3: number }[]) {
          const row = body.insertRow();
          for (const text of [names.get(item.first_body_id) ?? item.first_body_id, names.get(item.second_body_id) ?? item.second_body_id, (item.volume_mm3/(lengthUnit.factor*1000)**3).toFixed(lengthUnit.decimals)]) row.insertCell().textContent = text;
        }
        measurements.append(table);
      }
    } catch (error) { if (!closed && ticket === revision) status.textContent = error instanceof Error ? error.message : String(error); }
  };
  for (const control of [plane, offset, reverse, density, count, scale, threshold]) control.addEventListener("change", () => void update());
  window.addEventListener("aether-part-updated", close);
  window.addEventListener("aether-feature-preview-start", close);
  void update();
}
