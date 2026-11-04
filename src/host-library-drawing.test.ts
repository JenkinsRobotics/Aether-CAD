import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
import { createDrawingDocument } from "@aether/core/drawing";
import { readRecovery, recoveryKey } from "@aether/session/autosave";
import { readAetherCAD, tabArchive } from "./document/aethercad-archive";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
let dom: { window: Window & { close(): void } };
const source = createRectanglePartDocument("Bracket", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
type Stored = { id: string; name: string; revision: number; writable: boolean; data_base64: string };
let files: Map<string, Stored>, calls: { action: string; data: Record<string, unknown> }[];
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const bytesOf = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
/** What the server projects from a stored document archive. */
const projectOf = (file: Stored) => {
  const { graph, kind } = readAetherCAD(bytesOf(file.data_base64));
  return { ...file, project: { kind, parts: graph.part_definitions.map(p => ({ id: p.id, name: p.name, document: p.feature_document })), assemblies: [],
    ...(graph.drawings ? { drawings: graph.drawings.map(d => ({ id: d.id, name: d.name, document: d.document })) } : {}) } };
};
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); calls = [];
  files = new Map([["part", { id: "part", name: "Bracket.aethercad", revision: 1, writable: true, data_base64: b64(tabArchive(source, "part").bytes) }]]);
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/cad/index.html?document=part&part=" + source.documentId + "&branch=experiment&isolated=1" });
  for (const key of ["window", "document", "location", "history", "localStorage", "sessionStorage", "Event", "CustomEvent", "File", "FileReader"]) vi.stubGlobal(key, (dom.window as unknown as Record<string, unknown>)[key]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/status") return new Response(JSON.stringify({ user: { id: "operator" } }));
    const data = JSON.parse(String(init?.body)), action = url.split("/").at(-1)!; calls.push({ action, data });
    if (action === "create") files.set("drawing", { id: "drawing", name: data.name, revision: 1, writable: true, data_base64: data.data_base64 });
    const file = files.get(action === "create" ? "drawing" : data.id)!;
    if (!file) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    if (action === "save") {
      if (data.expected_revision !== file.revision) return new Response(JSON.stringify({ error: "changed elsewhere" }), { status: 409 });
      file.data_base64 = data.data_base64; file.revision++;
    }
    return new Response(JSON.stringify(action === "project_read" ? projectOf(file) : file));
  }));
});
afterEach(() => { dom.window.close(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("autosaves a separate Drawing document, retains the source branch, and never rewrites the Part", async () => {
  const host = await import("./host-library"), session = await import("./document-session");
  await host.loadHostedFile(); host.markHostedClean();
  const sourceBytes = files.get("part")!.data_base64;
  const drawing = createDrawingDocument(source); drawing.sourceReference = host.hostedSourceReference();
  expect(drawing.sourceReference).toEqual({ fileId: "part", partId: source.documentId, branch: "experiment" });
  await host.flushAutosaveNow(); host.detachHostedFile();
  expect(location.search).not.toContain("branch"); expect(location.search).toContain("isolated=1");
  host.configureAutosave(async () => {}, () => tabArchive(drawing, "drawing"));
  host.markHostedDirty();
  const draft = new URLSearchParams(location.search).get("draft")!;
  expect(readRecovery(recoveryKey("cad", "operator", `${draft}:::`))).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1200);
  expect(session.documentSession()?.id).toBe("drawing");
  expect(location.search).toContain("document=drawing"); expect(location.search).not.toContain("branch");
  const storedDrawing = () => readAetherCAD(bytesOf(files.get("drawing")!.data_base64));
  expect(storedDrawing().kind).toBe("drawing");
  expect((storedDrawing().graph.drawings![0].document as { sourceReference: { branch: string } }).sourceReference.branch).toBe("experiment");
  drawing.name = "Edited drawing"; host.markHostedDirty(); await host.flushAutosaveNow();
  expect(files.get("drawing")!.revision).toBe(2); expect(files.get("part")!.data_base64).toBe(sourceBytes); expect(files.get("part")!.revision).toBe(1);
  expect(await host.readHostedSource(drawing.sourceReference!)).toEqual(source);
  expect(session.documentSession()?.id).toBe("drawing");
  expect(calls.slice(-2).map(c => c.action)).toEqual(["read", "project_read"]);
  expect(calls.at(-1)).toMatchObject({ data: { id: "part", branch: "experiment" } });
  expect(calls.filter(c => c.action === "save").every(c => c.data.id === "drawing" && c.data.branch === undefined)).toBe(true);
  const open = vi.fn(async () => {});
  await host.switchHostedDocument(new URL(host.hostedSourceURL(drawing.sourceReference!), location.href), open);
  expect(session.documentSession()?.id).toBe("part"); expect(open.mock.calls).toHaveLength(1);
});
it("recovers Drawing edits against their original revision and refuses a conflict", async () => {
  history.replaceState(null, "", "/cad/index.html?document=drawing");
  const drawing = createDrawingDocument(source), oldBytes = tabArchive(drawing, "drawing").bytes; drawing.name = "Recovered drawing";
  const bytes = tabArchive(drawing, "drawing").bytes;
  files.set("drawing", { id: "drawing", name: "Bracket Drawing.aethercad", revision: 2, writable: true, data_base64: b64(oldBytes) });
  // The scope names the open Drawing tab, so a recovery belongs to the tab it was taken from.
  const key = recoveryKey("cad", "operator", `drawing:${drawing.documentId}::`);
  sessionStorage.setItem(key, JSON.stringify({ text: JSON.stringify({ name: "Bracket Drawing.aethercad", data: Array.from(bytes) }), base: { id: "drawing", name: "Bracket Drawing.aethercad", revision: 1, writable: true } }));
  const host = await import("./host-library");
  host.configureAutosave(async () => {}, () => tabArchive(drawing, "drawing"));
  const recovered = (await host.loadHostedFile())!;
  const reading = new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(recovered); });
  await vi.runAllTimersAsync(); expect(new Uint8Array(await reading)).toEqual(bytes); host.markHostedClean();
  await expect(host.flushAutosaveNow()).rejects.toMatchObject({status:409});
  expect(files.get("drawing")!.data_base64).toBe(b64(oldBytes));
  expect(readRecovery<{ revision: number }>(key)?.base.revision).toBe(1);
});
it("reads a project Part source without changing the Drawing's document or element identity", async () => {
  history.replaceState(null, "", "/cad/index.html?document=drawing");
  files.set("drawing", { id: "drawing", name: "Drawing.aethercad", revision: 1, writable: true, data_base64: b64(tabArchive(createDrawingDocument(source), "drawing").bytes) });
  const host = await import("./host-library"); await host.loadHostedFile(); host.markHostedClean();
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const data = JSON.parse(String(init?.body));
    if (data.id !== "project") return original(url, init);
    calls.push({ action: String(url).split("/").at(-1)!, data });
    return new Response(JSON.stringify({ id: "project", name: "Project.aethercad", revision: 7, writable: true, project: { kind: "part", parts: [{ id: "element", name: "Bracket", document: source }], assemblies: [] } }));
  });
  expect(await host.readHostedSource({ fileId: "project", partId: "element", branch: "test", revision: 7 })).toEqual(source);
  expect(calls.slice(-2)).toMatchObject([{ action: "read_revision", data: { revision: 7, branch: "test" } }, { action: "project_read", data: { revision: 7, branch: "test" } }]);
  expect((await import("./document-session")).documentSession()?.id).toBe("drawing"); expect(host.activeProject?.drawings).toHaveLength(1);
});

it("opens and autosaves an embedded Drawing against its design without creating a second document", async () => {
  history.replaceState(null, "", "/cad/index.html?document=design&drawing=print&branch=experiment");
  const drawing = createDrawingDocument(source); drawing.documentId = 'print';
  const project = {kind:'mixed',parts: [{id:'part',name:'Bracket',document:source}],assemblies:[],drawings:[{id:'print',name:drawing.name,document:drawing}]};
  files.set('design',{id:'design',name:'Design.aethercad',revision:5,writable:true,data_base64:'archive'});
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/project_read')
    ? new Response(JSON.stringify({...files.get('design'),project})) : original(url, init));
  const persist = vi.fn(async () => ({file:{...files.get('design'),revision:6},project,drawing,id:'print'}));
  vi.doMock('./design/hosted-drawings',()=>({persistDesignDrawing:persist}));
  try {
    const host = await import('./host-library');
    const file = await host.loadHostedFile();expect(file?.name).toMatch(/\.aethercad$/);host.markHostedClean();
    drawing.name = 'Edited print';
    const edited = tabArchive(drawing, 'drawing');
    await host.saveHostedFile(edited.name, edited.bytes);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({id:'design',revision:5}),'experiment',expect.objectContaining({name:'Edited print'}),'print');
    expect(calls.some(call=>call.action==='create')).toBe(false);
    expect((await import('./document-session')).documentSession()?.id).toBe('design');
    expect(location.search).toContain('drawing=print');
  } finally { vi.doUnmock('./design/hosted-drawings'); }
});
