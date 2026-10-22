import { openCompactFeatureWindow } from "@aether/ui";
import {unitChoice, parseQuantity} from "@aether/core/units";
import {documentUnits} from "../document-preferences";
import {renderPhysicalProperties} from "./properties";
import { availableBodies, type PartDocument } from "@aether/core/document";
import type { ImportedModelData } from "../domain";
import { onEngine } from "../engine/evaluate-part";
import { analyzeOnAether, measureOnAether } from "../engine/aether/evaluator";
import type { MeasureReference } from "../measure/measure-reference";

let closeActive: (() => void) | undefined;
type Kind = "section" | "interference" | "properties" | "clearance" | "compare";
/** The engine answers with measurements and, for sections and interference, meshes to show. */
type AnalysisAnswer = { status: "ok"; measurements: Record<string, unknown>[]; parts?: ImportedModelData["parts"] };
export async function analyzePart(doc: PartDocument, analysis: { kind: Kind | "distance"; plane?: string; offset_mm?: number; reverse?: boolean; density_kg_m3?: number; entities?: readonly object[] }, signal?: AbortSignal) {
  void signal;
  if (analysis.kind === "distance") return onEngine<AnalysisAnswer>({ aether: async () => measureOnAether(doc, (analysis.entities ?? []) as MeasureReference[]) as unknown as AnalysisAnswer });
  const { kind, plane, offset_mm, reverse, density_kg_m3 } = analysis;
  return onEngine<AnalysisAnswer>({ aether: () => analyzeOnAether(doc, { kind, plane: plane as "XY" | "XZ" | "YZ" | undefined, offset_mm, reverse, density_kg_m3 }) });
}


export function openPartAnalysis(kind: Kind, doc: PartDocument | null, show: (model: ImportedModelData | null) => void) {
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
  const close = () => { if (closed) return; closed = true; window.removeEventListener("aether-feature-preview-start", close); revision++; controller?.abort(); show(null); window.removeEventListener("aether-part-updated", close); win.close(); };
  const win = openCompactFeatureWindow({ className: "cad-analysis-dialog", icon: "inspect", viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body, title: kind === "clearance" ? "Clearance" : kind === "compare" ? "Compare bodies" : kind === "section" ? "Section view" : kind === "properties" ? "Physical properties" : "Interference", acceptLabel: "Done", onAccept: close, onDiscard: close });
  closeActive = close;
  const status = document.createElement("p"); status.className = "cad-analysis-status"; status.setAttribute("role", "status");
  const plane = document.createElement("select"); plane.setAttribute("aria-label", "Section plane");
  for (const value of ["XY", "XZ", "YZ"]) plane.add(new Option(value, value));
  const offset = document.createElement("input"); offset.type = "number"; offset.value = "0"; offset.setAttribute("aria-label", `Section offset (${lengthUnit.unit})`);
  const reverse = document.createElement("input"); reverse.type = "checkbox"; reverse.setAttribute("aria-label", "Keep opposite side");
  if (kind === "section") { win.row("Plane", plane); win.row(`Offset (${lengthUnit.unit})`, offset); win.row("Keep opposite side", reverse); }
  const density = document.createElement("input"); density.type = "number"; density.placeholder = "Optional"; density.setAttribute("aria-label", `Density (${densityUnit.unit})`);
  if (kind === "properties") win.row(`Density (${densityUnit.unit})`, density);
  status.style.fontSize = "0.8rem";
  const measurements = document.createElement("div");
  measurements.style.maxHeight = "40vh"; measurements.style.overflowY = "auto";
  measurements.style.fontSize = "0.8rem";
  win.body.append(status, measurements);
  const update = async () => {
    const ticket = ++revision; controller?.abort(); controller = new AbortController(); show(null); measurements.replaceChildren(); status.textContent = "Computing exact solid geometry…";
    try {
      if (!offset.value.trim() || !Number.isFinite(Number(offset.value))) throw Error("Enter a finite section offset.");
      const densityValue = density.value.trim() ? parseQuantity(density.value,units,"density") : undefined;
      if (kind === "properties" && densityValue !== undefined && (!Number.isFinite(densityValue) || densityValue <= 0)) throw Error(`Density must be positive, in ${densityUnit.unit}.`);
      const result = await analyzePart(snapshot, { kind, ...(densityValue !== undefined ? {density_kg_m3:densityValue} : {}), plane: plane.value, offset_mm: parseQuantity(offset.value,units,"length")*1000, reverse: reverse.checked }, controller.signal);
      if (closed || ticket !== revision) return;
      if (kind === "properties") {
        status.textContent = densityValue === undefined ? "Exact geometry. Enter density to calculate mass and inertia." : "Uniform density applied to each body. Inertia is about each center of mass, in world axes.";
        measurements.append(renderPhysicalProperties(result.measurements as unknown as Parameters<typeof renderPhysicalProperties>[0],names,units));
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
  for (const control of [plane, offset, reverse, density]) control.addEventListener("change", () => void update());
  window.addEventListener("aether-part-updated", close);
  window.addEventListener("aether-feature-preview-start", close);
  void update();
}
