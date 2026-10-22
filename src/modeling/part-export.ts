import { onEngine } from "../engine/evaluate-part";
import { exportOnAether } from "../engine/aether/evaluator";
import { availableBodies, type PartDocument } from "@aether/core/document";
import { cadPresentation } from "../cad-presentation-store";

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
  const type = format === "step" ? "model/step" : "model/stl";
  return onEngine<Blob>({
    aether: async () => new Blob([(await exportOnAether(document, { format, bodyIds: bodyId ? [bodyId] : null, toleranceMillimeters })).bytes], { type }),
  });
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
