import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
import { DrawingEditor } from "../drawing/controller";
import { CADDrawingWorkspaceStore } from "../cad-drawing-workspace-store";
import { drawingAgentInteraction } from "./drawing-agent";

const loader = vi.hoisted(() => ({ loadDrawingFont: vi.fn() }));
vi.mock("../drawing/pdf-export", () => loader);
const font = readFileSync(createRequire(import.meta.url).resolve("@aether/assets/fonts/noto-sans/NotoSans-Regular.ttf"));
afterEach(() => vi.resetAllMocks());
async function fixture() {
  const editor = new DrawingEditor(new CADDrawingWorkspaceStore(), async () => ({ visible: [], hidden: [], bounds: [0, 0, 10, 10], bodyIds: ["body"] }));
  editor.configure(() => createRectanglePartDocument("PDF", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 }));
  await editor.enter();
  let context = "drawing";
  const interaction = drawingAgentInteraction(editor, context, () => context);
  const exportPDF = (signal = new AbortController().signal) => interaction.execute({
    id: "export", name: "aether_cad_drawing_export",
    arguments: { format: "pdf", all_sheets: true, expected_revision: editor.snapshot()!.revision },
  }, signal);
  return { editor, exportPDF, leave: () => { context = "part"; } };
}

it("exports read-only drawings without mutating history or content", async () => {
  loader.loadDrawingFont.mockResolvedValue(font);
  const { editor, exportPDF } = await fixture();
  editor.configure(() => null, { writable: () => false });
  const before = editor.serialize(), history = editor.history();
  const result = await exportPDF() as { data_base64: string };
  expect(Buffer.from(result.data_base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  expect(editor.serialize()).toBe(before);
  expect(editor.history()).toEqual(history);
});

it.each(["revision", "context", "cancel"])("refuses a completed PDF after %s changes while loading its font", async reason => {
  let resolve!: (bytes: Uint8Array) => void;
  loader.loadDrawingFont.mockImplementation(() => new Promise<Uint8Array>(done => { resolve = done; }));
  const { editor, exportPDF, leave } = await fixture();
  const abort = new AbortController();
  const pending = exportPDF(abort.signal);
  // Install rejection handling before resolving the resource load.
  const refusal = expect(pending).rejects.toThrow();
  expect(loader.loadDrawingFont).toHaveBeenCalledTimes(1);
  if (reason === "revision") await editor.execute({ type: "update-sheet", sheetId: editor.snapshot()!.document.activeSheetId, name: "Changed" });
  if (reason === "context") leave();
  if (reason === "cancel") abort.abort();
  const before = editor.serialize();
  resolve(font);
  await refusal;
  expect(editor.serialize()).toBe(before);
});
