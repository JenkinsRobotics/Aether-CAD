import { createEmptyPartDocument, insertFeature, validatePartDocument, type PartDocument } from "@aether/core/document";

/** Build a candidate only. The caller commits after a successful native build. */
export async function appendSTEP(document: PartDocument | null, file: File): Promise<PartDocument> {
  if (!/\.(step|stp)$/i.test(file.name)) throw Error("Choose a STEP (.step or .stp) file.");
  if (!file.size || file.size > 3 * 1024 * 1024) throw Error("STEP imports must be nonempty and at most 3 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const base = document ?? createEmptyPartDocument(file.name.replace(/\.(step|stp)$/i, ""));
  const id = crypto.randomUUID();
  const next = insertFeature(base, {
    id, type: "import-step", name: `Import ${file.name}`, sourceName: file.name,
    dataBase64: btoa(binary), operation: "new", suppressed: false,
    bodyId: `${base.documentId}:body-${id}`,
  });
  next.bodyProperties = { ...next.bodyProperties, [`${base.documentId}:body-${id}`]: { name: file.name.replace(/\.(step|stp)$/i, ""), visible: true } };
  // Hosted saves base64-encode JSON again; remain within its request budget.
  if (new TextEncoder().encode(JSON.stringify(next, null, 2)).length > 4 * 1024 * 1024)
    throw Error("This part exceeds the 4 MiB saved-document budget. Import fewer or smaller STEP files.");
  validatePartDocument(next);
  return next;
}
