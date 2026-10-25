import { expect, it, vi } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
import { createDrawingDocument, serializeDrawingDocument, type PartDrawingProjection } from "@aether/core/drawing";
import { CADDrawingWorkspaceStore } from "../cad-drawing-workspace-store";
import { decodeDrawingProjection } from "../cad-drawing-bridge";
import { DrawingEditor } from "./controller";

const source = () => createRectanglePartDocument("Part", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
const view = { id: "front", name: "Front", orientation: "front" as const, originMm: [100, 100] as [number, number], scale: 1, hiddenLines: true };
const geometry: PartDrawingProjection = { visible: [{ kind: "line", start: [0, 0], end: [40, 10] }], hidden: [], bounds: [0, 0, 40, 10], bodyIds: ["body"] };
it("publishes validated presentation, supports undo/redo and reopens without the source Part", async () => {
  const store = new CADDrawingWorkspaceStore(), editor = new DrawingEditor(store, async () => geometry);
  editor.configure(source); await editor.enter();
  const sheetId = editor.snapshot()!.document.activeSheetId;
  await editor.execute({ type: "add-view", sheetId, view });
  expect(decodeDrawingProjection(store.snapshot().projection).sheets[0].views).toHaveLength(1);
  expect(editor.history()).toEqual({ canUndo: true, canRedo: false, busy: false });
  const saved = editor.serialize();
  await editor.travel(-1); expect(editor.snapshot()!.sheets[0].views).toHaveLength(0);
  await editor.travel(1); expect(editor.snapshot()!.sheets[0].views).toHaveLength(1);
  editor.configure(() => null); await editor.open(saved);
  expect(editor.serialize()).toBe(saved);
});
it("keeps the last good document and history when exact geometry fails", async () => {
  const project = vi.fn(async () => geometry), store = new CADDrawingWorkspaceStore(), editor = new DrawingEditor(store, project);
  editor.configure(source); await editor.enter();
  const before = editor.serialize();
  project.mockRejectedValueOnce(Error("Invalid solid"));
  await expect(editor.execute({ type: "add-view", sheetId: editor.snapshot()!.document.activeSheetId, view })).rejects.toThrow("Invalid solid");
  expect(editor.serialize()).toBe(before); expect(editor.history().canUndo).toBe(false); expect(store.snapshot().loadState).toBe("ready");
});
it("rejects concurrent edits while rebuilding and clears busy after completion", async () => {
  let resolve!: (result: PartDrawingProjection) => void;
  const editor = new DrawingEditor(new CADDrawingWorkspaceStore(), () => new Promise(r => { resolve = r; }));
  editor.configure(source); await editor.enter();
  const sheetId = editor.snapshot()!.document.activeSheetId;
  const pending = editor.execute({ type: "add-view", sheetId, view });
  await expect(editor.execute({ type: "select-sheet", sheetId })).rejects.toThrow(/already running/);
  resolve(geometry); await pending;
  expect(editor.history().busy).toBe(false); expect(editor.snapshot()!.sheets[0].views).toHaveLength(1);
});
it("does not replace the current drawing when an opened file fails to build", async () => {
  const store = new CADDrawingWorkspaceStore(), editor = new DrawingEditor(store, async () => { throw Error("Missing body"); });
  editor.configure(source); await editor.enter(); const original = editor.serialize();
  const invalid = createDrawingDocument(source()); invalid.sheets[0].views.push(view);
  await expect(editor.open(serializeDrawingDocument(invalid))).rejects.toThrow(/Missing body/);
  expect(editor.serialize()).toBe(original);
});
it("marks the saved source stale after an upstream edit until explicitly rebuilt", async () => {
  const part = source(), store = new CADDrawingWorkspaceStore(), editor = new DrawingEditor(store, async () => geometry);
  editor.configure(() => part); await editor.enter();
  await editor.execute({ type: "add-view", sheetId: editor.snapshot()!.document.activeSheetId, view });
  part.name = "Changed Part";
  await editor.enter();
  expect(store.snapshot().rebuild?.status).toBe("stale");
  expect(store.snapshot().projection?.sheets[0].views[0].state).toBe("stale");
  expect(editor.snapshot()!.document.source.name).toBe("Part");
  await editor.refresh(); expect(store.snapshot().rebuild?.status).toBe("current");
  expect(editor.snapshot()!.document.source.name).toBe("Changed Part");
});
