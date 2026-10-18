import {unitChoice, parseQuantity} from "@aether/core/units";
import {documentUnits} from "../document-preferences";
import {renderPhysicalProperties} from "./properties";
import { openFeatureWindow } from "@aether/ui";
import { availableBodies, type PartDocument } from "@aether/core/document";
import { translateDocument } from "../freecad-translate";
import { toPartGeometry, requireFeatureCapabilities } from "../freecad-geometry";
import type { ImportedModelData } from "../domain";

let closeActive: (() => void) | undefined;
type Kind = "section" | "interference" | "properties";
export async function analyzePart(doc: PartDocument, analysis: { kind: Kind; plane?: string; offset_mm?: number; reverse?: boolean; density_kg_m3?: number }, signal?: AbortSignal) {
  const translation = translateDocument(doc);
  if (!translation.complete) throw Error(translation.untranslated.map(f => `${f.name}: ${f.reason}`).join("\n"));
  await requireFeatureCapabilities(translation.features);
  const response = await fetch("/api/cad/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ features: translation.features, analysis }) });
  const result = await response.json();
  if (!response.ok || result.status !== "ok") throw Error(result.error || result.message || "Analysis failed.");
  return result;
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
  const win = openFeatureWindow({ className: "cad-analysis-dialog", viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body, title: kind === "section" ? "Section view" : kind === "properties" ? "Physical properties" : "Interference", acceptLabel: "Close analysis", discardLabel: "Close", onAccept: close, onDiscard: close });
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
        measurements.append(renderPhysicalProperties(result.measurements,names,units));
        return;
      }
      const parts = result.bodies.map(toPartGeometry);
      show({ sourceName: snapshot.name, parts, parseMilliseconds: 0 });
      status.textContent = kind === "section"
        ? `Capped section · ${parts.length} bodies remain. Close to restore the complete model.`
        : result.measurements.length ? `${result.measurements.length} interfering body pairs. Overlap geometry is shown in the viewport.` : "No solid-volume interference. Touching faces are not an overlap.";
      if (kind === "interference" && result.measurements.length) {
        const table = document.createElement("table"); table.style.width = "100%";
        const header = table.createTHead().insertRow();
        for (const label of ["Body", "Body", `Volume (${lengthUnit.unit}³)`]) { const cell = document.createElement("th"); cell.textContent = label; cell.style.textAlign = "left"; header.append(cell); }
        const body = table.createTBody();
        for (const item of result.measurements) {
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
