import { onEngine } from "../engine/evaluate-part";
import { exportOnAether } from "../engine/aether/evaluator";
import { availableBodies, type PartDocument } from "@aether/core/document";
import type { ExportFormat } from "@aether/core/contracts";

/** Download extension and MIME type per export format; glTF ships as binary GLB. */
export const PART_EXPORT_FILES: Record<ExportFormat, { extension: string; type: string; label: string }> = {
  step: { extension: "step", type: "model/step", label: "STEP — exact solid (.step)" },
  stl: { extension: "stl", type: "model/stl", label: "STL — manufacturing mesh (.stl)" },
  obj: { extension: "obj", type: "model/obj", label: "OBJ — mesh with named bodies (.obj)" },
  gltf: { extension: "glb", type: "model/gltf-binary", label: "glTF — binary mesh for previews and animation (.glb)" },
  "3mf": { extension: "3mf", type: "model/3mf", label: "3MF — printing mesh (.3mf)" },
};
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

export async function createPartExport(document: PartDocument, format: ExportFormat, bodyId?: string, toleranceMillimeters = 0.1) {
  const { type } = PART_EXPORT_FILES[format];
  return onEngine<Blob>({
    aether: async () => new Blob([(await exportOnAether(document, { format, bodyIds: bodyId ? [bodyId] : null, toleranceMillimeters })).bytes], { type }),
  });
}

export async function downloadPartExport(format: ExportFormat, bodyId?: string, toleranceMillimeters = 0.1) {
  const doc = currentDocument();
  if (!doc) throw new Error("Open a Part first.");
  const snapshot = structuredClone(doc);
  const blob = await createPartExport(snapshot, format, bodyId, toleranceMillimeters);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url;
  anchor.download = `${snapshot.name.replace(/[\\/:*?"<>|]/g, "_")}.${PART_EXPORT_FILES[format].extension}`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
