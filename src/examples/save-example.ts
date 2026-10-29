import { documentRequest } from "@aether/session/documents";
import { isStudioExampleHosted as isStudioHosted } from "./runtime";
import { base64, readExample, type CADExample } from "./catalog";

export async function saveExample(example: CADExample): Promise<string> {
  const file = await readExample(example);
  if (!isStudioHosted()) {
    const url = URL.createObjectURL(file),
      link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "";
  }
  // An explicit personal destination never inherits the current company workspace.
  const saved = await documentRequest<{ id: string }>("cad", "create", {
    name: file.name,
    kind: "file",
    scope: "personal",
    organization: "default",
    workspace: null,
    parent: null,
    data_base64: base64(new Uint8Array(await file.arrayBuffer())),
  });
  const url = new URL("./index.html", location.href);
  url.search = "";
  url.searchParams.set("document", saved.id);
  url.searchParams.set("assembly", example.assemblyId);
  return url.href;
}
