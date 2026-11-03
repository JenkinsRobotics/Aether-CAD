/** File lifecycle is provided by CAD's existing document/session adapter. Keeping
 * this separate lets the presentation use the same route in local previews. */
import { drawingEditor } from "./controller";
import { cadPresentation } from "../cad-presentation-store";
import { readAetherCAD, tabArchive } from "../document/aethercad-archive";
export function downloadDrawingFile(name: string, content: string | Uint8Array, type = "application/json"): void {
  const bytes = typeof content === "string" ? content : Uint8Array.from(content).buffer;
  const url = URL.createObjectURL(new Blob([bytes], { type })), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export interface DrawingFileActions {
  create: (name?: string) => Promise<void>;
  open: (file: File) => Promise<void>;
  save: () => Promise<void>;
  leave: () => Promise<void>;
}
let actions: DrawingFileActions = {
  create: () => drawingEditor.create(),
  open: async file => {
    if (file.size > 32 * 1024 * 1024) throw Error("Drawing file exceeds 32 MiB.");
    const entry = readAetherCAD(new Uint8Array(await file.arrayBuffer())).graph.drawings?.[0];
    if (!entry) throw Error("This document has no Drawing.");
    await drawingEditor.open(JSON.stringify(entry.document));
  },
  save: async () => { const archive = tabArchive(drawingEditor.snapshot()!.document, "drawing"); downloadDrawingFile(archive.name, archive.bytes, "application/vnd.aether.workspace+zip"); },
  leave: async () => { cadPresentation.dispatch({ type: "select-workspace-mode", mode: "modeling" }); },
};
export function configureDrawingFiles(next: DrawingFileActions): void { actions = next; }
export const drawingFiles: DrawingFileActions = {
  create: name => actions.create(name), open: file => actions.open(file), save: () => actions.save(), leave: () => actions.leave(),
};
