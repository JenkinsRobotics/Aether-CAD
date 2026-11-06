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
it("refuses read-only edits, and cancellation or context changes during a rebuild", async () => {
  let writable = true, context = "first", resolve!: (result: PartDrawingProjection) => void;
  const changed = vi.fn(), editor = new DrawingEditor(new CADDrawingWorkspaceStore(), () => new Promise(r => { resolve = r; }));
  editor.configure(source, { writable: () => writable, contextKey: () => context, changed }); await editor.enter();
  const original = editor.serialize(), command = { type: "add-view" as const, sheetId: editor.snapshot()!.document.activeSheetId, view };
  writable = false; await expect(editor.execute(command)).rejects.toThrow(/read-only/); writable = true;
  for (const interrupt of [() => { context = "other"; }, () => { writable = false; }]) {
    context = "first"; writable = true;
    const pending = editor.execute(command); interrupt(); resolve(geometry);
    await expect(pending).rejects.toThrow(); expect(editor.serialize()).toBe(original); expect(editor.history().canUndo).toBe(false);
  }
  writable = true;
  const signal = new AbortController(), pending = editor.execute(command, { signal: signal.signal }); signal.abort(); resolve(geometry);
  await expect(pending).rejects.toThrow(); expect(editor.serialize()).toBe(original);
  expect(changed.mock.calls).toEqual([["opened"]]);
});
it("reads a source asynchronously and refuses a different source without advancing history", async () => {
  const part = source(), readSource = vi.fn(async () => ({ ...part, name: "New source revision" }));
  const editor = new DrawingEditor(new CADDrawingWorkspaceStore(), async () => geometry);
  editor.configure(() => part, { readSource }); await editor.enter();
  await editor.refresh(); expect(editor.snapshot()!.document.source.name).toBe("New source revision");
  await editor.travel(-1); expect(editor.snapshot()!.document.source.name).toBe("Part");
  readSource.mockResolvedValueOnce({ ...part, documentId: "wrong" });
  await expect(editor.refresh()).rejects.toThrow(/same source/); expect(editor.history().canRedo).toBe(true);
});
it("allows viewing other sheets in a read-only drawing without editing saved intent or history", async () => {
  let writable = true;
  const store = new CADDrawingWorkspaceStore(), editor = new DrawingEditor(store, async () => geometry);
  editor.configure(source, { writable: () => writable }); await editor.enter();
  const first = editor.snapshot()!.document.activeSheetId;
  await editor.execute({ type: "add-sheet", sheet: { id: "second", name: "Second", widthMm: 210, heightMm: 297, projection: "third_angle", views: [], annotations: [] } });
  const before = editor.serialize(), history = editor.history(); writable = false;
  await editor.selectSheet(first);
  expect(store.snapshot().projection?.active_sheet_id).toBe(first);
  expect(editor.displayedSheetId()).toBe(first); expect(editor.serialize()).toBe(before); expect(editor.history()).toEqual(history);
  await expect(editor.execute({ type: "select-sheet", sheetId: first })).rejects.toThrow(/read-only/);
});

it("publishes section hatches through the existing drawing canvas and retains intent across history",async()=>{
  const store = new CADDrawingWorkspaceStore();
  const editor = new DrawingEditor(store,async()=>({...geometry,hatch:[{kind:"line" as const,start:[1,1] as [number,number],end:[3,3] as [number,number]}]}));
  editor.configure(source);await editor.enter();
  await editor.execute({type:"add-view",sheetId:editor.snapshot()!.document.activeSheetId,view:{...view,section:{offsetMm:0,hatchSpacingMm:2}}});
  const projection=decodeDrawingProjection(store.snapshot().projection);
  expect(projection.capabilities.can_project_sections).toBe(true);
  expect(projection.sheets[0].views[0].type_id).toBe("section");
  expect(projection.sheets[0].views[0].geometry.primitives.some(p=>p.layer_id==="hatch")).toBe(true);
  const saved=editor.serialize();await editor.travel(-1);expect(editor.snapshot()!.document.formatVersion).toBe(1);
  await editor.travel(1);expect(editor.serialize()).toBe(saved);
  await editor.open(saved);expect(editor.serialize()).toBe(saved);
});

it("treats a chain as one undo step and preserves it when any new member cannot attach", async () => {
  const editor = new DrawingEditor(new CADDrawingWorkspaceStore(), async () => geometry);
  editor.configure(source); await editor.enter();
  const sheetId = editor.snapshot()!.document.activeSheetId;
  await editor.execute({ type: "add-view", sheetId, view });
  const before = editor.serialize();
  const chain = { id: "chain", viewId: "front", pointsMm: [[80,105],[120,95],[80,105]] as [number,number][], positionMm: [100,80] as [number,number], decimals: 2 };
  await editor.execute({ type: "add-dimension-chain", sheetId, chain });
  const saved = editor.serialize();
  expect(editor.snapshot()!.sheets[0].annotations).toHaveLength(2);
  await editor.travel(-1); expect(editor.serialize()).toBe(before);
  await editor.travel(1); expect(editor.serialize()).toBe(saved);
  await expect(editor.execute({ type: "add-dimension-chain", sheetId, chain: { ...chain, id: "broken", pointsMm: [[80,105],[120,95],[0,0]] } })).rejects.toThrow(/within 5 mm/);
  expect(editor.serialize()).toBe(saved);
  await editor.travel(-1); expect(editor.serialize()).toBe(before);
});
