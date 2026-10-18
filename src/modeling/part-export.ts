import { availableBodies, type PartDocument } from "@aether/core/document";
import { translateDocument } from "../freecad-translate";
import { cadPresentation } from "../cad-presentation-store";
import { requireFeatureCapabilities } from "../freecad-geometry";

let currentDocument: () => PartDocument | null = () => null;
let requestedBody: string | undefined;
export function requestPartExport(bodyId: string) {
  requestedBody = bodyId;
  cadPresentation.patch({ startDialog: "export" });
}
export function consumeExportBody(): string | undefined {
  const id = requestedBody;
  requestedBody = undefined;
  return exportBodyChoices().some(body => body.id === id) ? id : undefined;
}
export function configurePartExport(getDocument: () => PartDocument | null) { currentDocument = getDocument; }
export function exportBodyChoices() { const doc = currentDocument(); return doc ? availableBodies(doc) : []; }

export async function createPartExport(document: PartDocument, format: "step" | "stl", bodyId?: string, toleranceMillimeters = 0.1) {
  const translation = translateDocument(document);
  if (!translation.complete) throw new Error(translation.untranslated.map(f => `${f.name}: ${f.reason}`).join("\n"));
  await requireFeatureCapabilities(translation.features);
  const response = await fetch("/api/cad/export", {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(75000),
    body: JSON.stringify({ features: translation.features, format, body_ids: bodyId ? [bodyId] : null, tolerance_mm: toleranceMillimeters }),
  });
  const result = await response.json();
  if (!response.ok || result.status !== "ok") throw new Error(result.error || result.diagnostics?.map((d: { message: string }) => d.message).join("\n") || result.message || "Export failed.");
  if (result.format !== format || typeof result.data_base64 !== "string") throw new Error("The engine returned an invalid export.");
  const bytes = Uint8Array.from(atob(result.data_base64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: format === "step" ? "model/step" : "model/stl" });
}

export async function downloadPartExport(format: "step" | "stl", bodyId?: string, toleranceMillimeters = 0.1) {
  const doc = currentDocument();
  if (!doc) throw new Error("Open a Part first.");
  const snapshot = structuredClone(doc);
  const blob = await createPartExport(snapshot, format, bodyId, toleranceMillimeters);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url;
  anchor.download = `${snapshot.name.replace(/[\\/:*?"<>|]/g, "_")}.${format}`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
