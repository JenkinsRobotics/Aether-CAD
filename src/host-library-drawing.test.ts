import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
import { createDrawingDocument, serializeDrawingDocument } from "@aether/core/drawing";
import { readRecovery, recoveryKey } from "@aether/session/autosave";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
let dom: { window: Window & { close(): void } };
const source = createRectanglePartDocument("Bracket", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
type Stored = { id: string; name: string; revision: number; writable: boolean; data_base64: string };
let files: Map<string, Stored>, calls: { action: string; data: Record<string, unknown> }[];
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); calls = [];
  files = new Map([["part", { id: "part", name: "Bracket.acpart", revision: 1, writable: true, data_base64: btoa(JSON.stringify(source)) }]]);
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/cad/index.html?document=part&branch=experiment&isolated=1" });
  for (const key of ["window", "document", "location", "history", "sessionStorage", "Event", "CustomEvent", "File", "FileReader"]) vi.stubGlobal(key, (dom.window as unknown as Record<string, unknown>)[key]);
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
    return new Response(JSON.stringify(file));
  }));
});
afterEach(() => { dom.window.close(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("autosaves a separate Drawing, retains source branch, and never rewrites the Part", async () => {
  const host = await import("./host-library"), session = await import("./document-session");
  await host.loadHostedFile(); host.markHostedClean();
  const sourceBytes = files.get("part")!.data_base64;
  const drawing = createDrawingDocument(source); drawing.sourceReference = host.hostedSourceReference();
  expect(drawing.sourceReference).toEqual({ fileId: "part", branch: "experiment" });
  await host.flushAutosaveNow(); host.detachHostedFile();
  expect(location.search).not.toContain("branch"); expect(location.search).toContain("isolated=1");
  let text = serializeDrawingDocument(drawing);
  host.configureAutosave(async () => {}, () => ({ name: "Bracket Drawing.acdrw", bytes: new TextEncoder().encode(text) }));
  host.markHostedDirty();
  const draft = new URLSearchParams(location.search).get("draft")!;
  expect(readRecovery(recoveryKey("cad", "operator", `${draft}:::`))).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1200);
  expect(session.documentSession()?.id).toBe("drawing");
  expect(location.search).toContain("document=drawing"); expect(location.search).not.toContain("branch");
  expect(JSON.parse(atob(files.get("drawing")!.data_base64)).sourceReference.branch).toBe("experiment");
  drawing.name = "Edited drawing"; text = serializeDrawingDocument(drawing); host.markHostedDirty(); await host.flushAutosaveNow();
  expect(files.get("drawing")!.revision).toBe(2); expect(files.get("part")!.data_base64).toBe(sourceBytes); expect(files.get("part")!.revision).toBe(1);
  expect(await host.readHostedSource(drawing.sourceReference!)).toEqual(source);
  expect(session.documentSession()?.id).toBe("drawing");
  expect(calls.at(-1)).toMatchObject({ action: "read", data: { id: "part", branch: "experiment" } });
  expect(calls.filter(c => c.action === "save").every(c => c.data.id === "drawing" && c.data.branch === undefined)).toBe(true);
  const open = vi.fn(async () => {});
  await host.switchHostedDocument(new URL(host.hostedSourceURL(drawing.sourceReference!), location.href), open);
  expect(session.documentSession()?.id).toBe("part"); expect(open.mock.calls).toHaveLength(1);
});
it("recovers Drawing edits against their original revision and refuses a conflict", async () => {
  history.replaceState(null, "", "/cad/index.html?document=drawing");
  const drawing = createDrawingDocument(source), oldText = serializeDrawingDocument(drawing); drawing.name = "Recovered drawing";
  const text = serializeDrawingDocument(drawing);
  files.set("drawing", { id: "drawing", name: "Bracket Drawing.acdrw", revision: 2, writable: true, data_base64: btoa(oldText) });
  const key = recoveryKey("cad", "operator", "drawing:::");
  sessionStorage.setItem(key, JSON.stringify({ text: JSON.stringify({ name: "Bracket Drawing.acdrw", data: Array.from(new TextEncoder().encode(text)) }), base: { id: "drawing", name: "Bracket Drawing.acdrw", revision: 1, writable: true } }));
  const host = await import("./host-library");
  host.configureAutosave(async () => {}, () => ({ name: "Bracket Drawing.acdrw", bytes: new TextEncoder().encode(text) }));
  const recovered = (await host.loadHostedFile())!;
  const reading = new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(recovered); });
  await vi.runAllTimersAsync(); expect(await reading).toBe(text); host.markHostedClean();
  await expect(host.flushAutosaveNow()).rejects.toThrow(/changed elsewhere/);
  expect(files.get("drawing")!.data_base64).toBe(btoa(oldText));
  expect(readRecovery<{ revision: number }>(key)?.base.revision).toBe(1);
});
it("reads a project Part source without changing the Drawing's document or element identity", async () => {
  history.replaceState(null, "", "/cad/index.html?document=drawing");
  files.set("drawing", { id: "drawing", name: "Drawing.acdrw", revision: 1, writable: true, data_base64: btoa("{}") });
  const host = await import("./host-library"); await host.loadHostedFile(); host.markHostedClean();
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const data = JSON.parse(String(init?.body));
    if (data.id !== "project") return original(url, init);
    calls.push({ action: String(url).split("/").at(-1)!, data });
    return new Response(JSON.stringify({ id: "project", name: "Project.acad", revision: 7, writable: true, project: { parts: [{ id: "element", name: "Bracket", document: source }], assemblies: [] } }));
  });
  expect(await host.readHostedSource({ fileId: "project", partId: "element", branch: "test", revision: 7 })).toEqual(source);
  expect(calls.slice(-2)).toMatchObject([{ action: "read_revision", data: { revision: 7, branch: "test" } }, { action: "project_read", data: { revision: 7, branch: "test" } }]);
  expect((await import("./document-session")).documentSession()?.id).toBe("drawing"); expect(host.activeProject).toBeNull();
});
