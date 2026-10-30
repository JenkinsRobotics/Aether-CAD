import {documentURL} from '@aether/session/home/runtime';
import {isLocalDocument} from '@aether/session/home/runtime';
import { prepareSaveRecovery, SaveRecoveryController, downloadRecovery, type RecoverySelection } from '@aether/session/save-recovery';
import { documentRequest } from "@aether/session/documents";
import { AutosaveSession, SaveError, recoveryKey, sessionOwner } from "@aether/session/autosave";
import { configureDocumentSession } from "./document-session";
import { isPartFile, isProjectFile, isDrawingFile } from "@aether/core/document/file-types";
import { parsePartDocument, type PartDocument } from "@aether/core/document";
import { parseDrawingDocument, type DrawingDocument, type DrawingSourceReference } from "@aether/core/drawing";
import type { AssemblyProjectionV1 } from './cad-assembly-bridge';
/** Hosted file transport only; document interpretation stays in Core. */
export const hostedCAD = (isLocalDocument() || location.pathname.startsWith("/cad/"));
type StoredFile = {
  id: string;
  name: string;
  revision: number;
  writable: boolean;
  data_base64?: string;
};
export type Project = {
  id?: string;
  parts: {
    id: string;
    name: string;
    document: unknown;
    source?: { kind: string; asset_ref?: string; label?: string };
  }[];
  assemblies: { id: string; name: string }[];
  drawings?: { id: string; name: string; document: unknown }[];
};
export let activeProject: Project | null = null;
/** Refresh project tabs from the active canonical archive after an assembly
 * edit. Persistence still serializes that archive through the normal save path. */
export function syncHostedAssemblyProject(projection: AssemblyProjectionV1): void {
  if (activeProject ? activeProject.id !== projection.workspace_id : !query.has('example')) return;
  activeProject = {...activeProject, id: projection.workspace_id,
    parts:projection.part_definitions.map(part=>({id:part.id,name:part.name,document:part.feature_document,
      source:{kind:part.source.kind,label:part.source.label,asset_ref:part.source.asset_ref??undefined}})),
    assemblies:projection.assemblies.map(assembly=>({id:assembly.id,name:assembly.name})),
  };
}
/** Saved container name, distinct from the active Part Studio name. */
export function hostedDocumentName(): string | null { return active?.name ?? null; }
/** Capture a source locator without changing the active editor/save target. */
export function hostedSourceReference(): DrawingSourceReference | undefined {
  if (!active || (!activePartId && !isPartFile(active.name))) return undefined;
  return { fileId: active.id, ...(activePartId ? { partId: activePartId } : {}),
    ...(query.has("branch") ? { branch: query.get("branch")! } : {}),
    ...(query.has("revision") ? { revision: Number(query.get("revision")) } : {}) };
}
export function hostedSourceURL(ref: DrawingSourceReference): string {
  const search = new URLSearchParams({ document: ref.fileId });
  if (ref.partId) search.set("part", ref.partId);
  if (ref.branch) search.set("branch", ref.branch);
  if (ref.revision !== undefined) search.set("revision", String(ref.revision));
  return `/cad/index.html?${search}`;
}
export async function readHostedSource(ref: DrawingSourceReference): Promise<PartDocument> {
  const file = await request(ref.revision === undefined ? "read" : "read_revision", {
    id: ref.fileId, branch: ref.branch, ...(ref.revision === undefined ? {} : { revision: ref.revision }),
  });
  if (ref.partId) {
    if (!isProjectFile(file.name)) throw Error("The drawing source is no longer a project.");
    const result = await request("project_read", { id: ref.fileId, revision: file.revision, branch: ref.branch }) as StoredFile & { project: Project };
    const part = result.project.parts.find(part => part.id === ref.partId);
    if (!part?.document) throw Error("The drawing's source Part is no longer present in this project.");
    return parsePartDocument(JSON.stringify(part.document));
  }
  if (!isPartFile(file.name) || !file.data_base64) throw Error("The drawing source is not a saved Part.");
  return parsePartDocument(new TextDecoder().decode(Uint8Array.from(atob(file.data_base64), c => c.charCodeAt(0))));
}
let activePartId: string | null = null;
let activeDrawingId: string | null = null;
let linkedPartReadOnly = false;
/** Live editor automation observes the same linked/revision access as saving. */
export function hostedPartEditable(): boolean {
  return !query.has('example') && (!hostedCAD || (!opening && !linkedPartReadOnly && active?.writable !== false && !query.has('revision')));
}
export async function editHostedProject(
  operation: string,
  name: string,
  extra: object = {},
) {
  if (dirty)
    throw new Error("Save your current work before changing project items.");
  if (!active?.writable || query.has("revision")) throw new Error("This project is read-only.");
  const result = (await request("project_edit", {
    id: active.id,
    expected_revision: active.revision,
    branch: query.get("branch") ?? undefined,
    operation,
    name,
    ...extra,
  })) as StoredFile & { project: Project };
  active = result;
  activeProject = result.project;
  queue?.updateBase(fileIdentity(active));
  return result;
}
/** Attach a fully built Drawing to the current design without creating a Drive file. */
export async function createHostedDesignDrawing(drawing: DrawingDocument): Promise<DrawingDocument> {
  if (!activeProject || !active?.writable || query.has("revision")) throw Error("Open a writable Hybrid design first.");
  await flushAutosaveNow();
  const { persistDesignDrawing } = await import("./design/hosted-drawings");
  const result = await persistDesignDrawing(active, query.get("branch") ?? undefined, drawing);
  active = result.file; activeProject = result.project; activePartId = null; activeDrawingId = result.id;
  linkedPartReadOnly = false;
  query.delete("part"); query.delete("assembly"); query.set("drawing", result.id);
  history.replaceState(null, "", location.pathname + "?" + query);
  startQueue();
  window.dispatchEvent(new Event("cad-document-navigation"));
  return result.drawing;
}
export function projectItemURL(id: string, kind: "part" | "assembly" | "drawing") {
  if (query.has('example')) return `/cad/index.html?editor=1&example=${encodeURIComponent(query.get('example')!)}&${kind}=${encodeURIComponent(id)}`;
  return (
    "/cad/index.html?document=" +
    encodeURIComponent(active!.id) +
    "&" +
    kind +
    "=" +
    encodeURIComponent(id) +
    (query.has("branch") ? "&branch=" + encodeURIComponent(query.get("branch")!) : "") +
    (query.has("revision")
      ? "&revision=" + encodeURIComponent(query.get("revision")!)
      : "")
  );
}
let active: StoredFile | null = null;
let saving = false;
let dirty = false;
configureDocumentSession(() => active, () => {
  if (dirty || saving) throw new Error("Save your current edits before changing document settings.");
});
/* Document scheduling and refresh recovery are shared with the other editors. */
type Snapshot = { name: string; bytes: Uint8Array };
type Draft = { name: string; data: number[] };
let autosaveFlush: (() => Promise<void>) | null = null;
let snapshot: (() => Snapshot | null) | null = null;
let queue: AutosaveSession<StoredFile | null> | null = null;
let owner = "";
let saveRecovery: SaveRecoveryController<StoredFile | null> | null = null;
export const hostedSaveRecovery = () => saveRecovery;
let opening = false;
let recovering = false;
let capture: Promise<void> | null = null;
let captureSerial = 0;
let draftID = "";
const snapshotText = (value: Snapshot) => JSON.stringify({ name: value.name, data: Array.from(value.bytes) });
function keyFor(file: StoredFile | null) {
  const scope = [file?.id ?? draftID, activeDrawingId ?? activePartId ?? query.get("assembly") ?? "", query.get("branch") ?? "", query.get("revision") ?? ""].join(":");
  return recoveryKey("cad", owner, scope);
}
function fileIdentity(file: StoredFile | null): StoredFile | null {
  if (!file) return null;
  const { id, name, revision, writable } = file; return { id, name, revision, writable };
}
function startQueue(text = "", selection: RecoverySelection<StoredFile | null> = { record: null, candidates: [], adopted: [] }) {
  saveRecovery?.dispose();
  queue?.dispose();
  if (query.has('example')) { queue = null; saveRecovery = null; dirty = false; return; }
  queue = new AutosaveSession({ key: keyFor(active), base: fileIdentity(active), text, keyForBase: keyFor, persistentRecovery: true,
    save: async (text, base) => {
      if (await sessionOwner(false) !== owner) throw new SaveError('Sign in with the account that opened this design.', 401);
      active = base;
      const value: Draft = JSON.parse(text);
      await persistHostedFile(value.name, new Uint8Array(value.data));
      return fileIdentity(active);
    },
  });
  const session = queue;
  saveRecovery = new SaveRecoveryController({ session, selection,
    sameBase: (a, b) => a?.id === b?.id && a?.revision === b?.revision,
    revision: base => base?.revision,
    verify: async () => {
      if (await sessionOwner(false) !== owner) throw new SaveError('Sign in with the account that opened this design.', 401);
      if (!session.base) {
        if (session.state.phase === 'conflict' && ![401, 403].includes(session.state.status ?? 0))
          throw Error('The first save could not be confirmed. Check My files before creating another copy.');
        return {base: null, text};
      }
      const fresh = await request('read', {id: session.base.id, branch: query.get('branch') ?? undefined});
      if (!fresh.writable || linkedPartReadOnly || query.has('revision')) throw new SaveError('This design is read only. Save a copy to keep edits.', 403);
      return { base: fileIdentity(fresh), text: await verifiedSnapshot(fresh) };
    },
    copy: copyHostedSnapshot,
    download: text => {
      const value: Draft = text ? JSON.parse(text) : snapshot?.() ? JSON.parse(snapshotText(snapshot!()!)) : null;
      if (!value) throw Error('Wait for the design to finish loading.');
      downloadRecovery(new Uint8Array(value.data), value.name);
    },
  });
  window.dispatchEvent(new Event('cad-save-recovery'));
  queue.subscribe(state => {
    if (queue?.dirty) dirty = true;
    else if (!capture) dirty = false;
    document.dispatchEvent(new CustomEvent("aether-save-state", { detail: state }));
  });
}
/** Read the same project item as the editor, without changing the active save target. */
async function verifiedSnapshot(file: StoredFile): Promise<string> {
  if (activePartId || activeDrawingId) {
    const result = await request('project_read', {id:file.id, revision:file.revision, branch:query.get('branch') ?? undefined}) as StoredFile & {project:Project};
    const item = activeDrawingId ? result.project.drawings?.find(d => d.id === activeDrawingId) : result.project.parts.find(p => p.id === activePartId);
    if (!item?.document) throw new SaveError('This item is no longer in the saved design. Download your edits.', 404);
    return snapshotText({name: item.name + (activeDrawingId ? '.acdrw' : '.acpart'), bytes: new TextEncoder().encode(JSON.stringify(item.document))});
  }
  return snapshotText({name:file.name,bytes:Uint8Array.from(atob(file.data_base64!), c => c.charCodeAt(0))});
}
/** Read the canonical editor snapshot without introducing another document store. */
export function currentEditorSnapshot(): Snapshot | null { return snapshot?.() ?? null; }
export function configureAutosave(flush: () => Promise<void>, getSnapshot?: () => Snapshot | null) {
  autosaveFlush = flush; snapshot = getSnapshot ?? null;
}
function captureDocument() {
  if (!autosaveFlush || opening || !dirty || capture) return;
  const serial = captureSerial;
  let completed = false;
  capture = autosaveFlush().then(() => { completed = true; }).catch(() => {}).finally(() => {
    capture = null;
    if (captureSerial !== serial && dirty) captureDocument();
    else if (completed && queue && !queue.dirty) dirty = false;
  });
}
export async function flushAutosaveNow() {
  if (capture) await capture;
  const value = snapshot?.();
  if (value && queue && dirty) queue.write(snapshotText(value));
  else if (!value && dirty && autosaveFlush) await autosaveFlush();
  await queue?.flush();
  if (queue?.dirty) await queue.flush();
  if (queue?.dirty) throw new Error("The design still has unsaved changes.");
}
/** Save the current snapshot as a new personal document, including conflict recovery. */
export async function copyHostedSnapshot() {
  if(capture)await capture;
  if (await sessionOwner(false) !== owner) throw new SaveError("Sign in with the account that opened this design.", 401);
  const current=snapshot?.();
  if(!current)throw new Error('Wait for the current document snapshot before making a copy.');
  let raw='';for(let i=0;i<current.bytes.length;i+=8192)raw+=String.fromCharCode(...current.bytes.subarray(i,i+8192));
  const file=await request('create',{name:current.name.replace(/(\.[^.]+)$/,' copy$1'),scope:'personal',data_base64:btoa(raw)});
  location.assign(documentURL(file.id));
}
export async function commitHosted(name: string, message: string) {
  if (!active) throw new Error("Open a server document to commit.");
  await flushAutosaveNow();
  await request("version", {
    id: active.id,
    expected_revision: active.revision,
    branch: query.get("branch") ?? undefined,
    name,
    message,
  });
}
export function markHostedDirty() {
  if (opening || query.has('example')) return;
  dirty = true; captureSerial++;
  const value = snapshot?.();
  if (value && queue) { queue.write(snapshotText(value)); }
  else captureDocument(); // Assemblies obtain their canonical archive from Core immediately.
}
export function markHostedClean() {
  opening = false;
  if (recovering) { recovering = false; dirty = true; queue?.pause(false); markHostedDirty(); }
  else dirty = false;
}
window.addEventListener("beforeunload", (event) => {
  if (hostedCAD && dirty && (!queue?.dirty || !queue.state.durable)) {
    event.preventDefault(); event.returnValue = "";
  }
});
let query = new URLSearchParams(location.search);
function request(action: string, data: object): Promise<StoredFile> {
  return documentRequest<StoredFile>("cad", action, { ...data });
}
export function detachHostedFile() {
  active = null;
  activeProject = null;
  activePartId = null;
  activeDrawingId = null;
  linkedPartReadOnly = false;
  document.querySelector(".project-tabs")?.remove();
  draftID = crypto.randomUUID();
  query = new URLSearchParams({ draft: draftID, editor: "" });
  if(isLocalDocument())query.set("storage","local");
  if (new URLSearchParams(location.search).has("isolated")) query.set("isolated", "1");
  history.replaceState(null, "", location.pathname + "?" + query);
  if (owner) startQueue();
}
/** Switch transport identity transactionally after the old document is saved. */
export async function switchHostedDocument(url: URL, open: (file: File, url: URL) => Promise<void>) {
  await flushAutosaveNow();
  const previous = { active, activeProject, activePartId, activeDrawingId, linkedPartReadOnly, query, draftID };
  let attemptedOpen = false;
  try {
    query = new URLSearchParams(url.search);
    active = null; activeProject = null; activePartId = null; activeDrawingId = null; linkedPartReadOnly = false;
    const file = await loadHostedFile(false);
    if (!file) throw new Error("This tab has no saved document.");
    attemptedOpen = true;
    await open(file, url);
    markHostedClean();
    url.search = query.toString();
  } catch (error) {
    active = previous.active; activeProject = previous.activeProject;
    activePartId = previous.activePartId; activeDrawingId = previous.activeDrawingId; linkedPartReadOnly = previous.linkedPartReadOnly;
    query = previous.query; draftID = previous.draftID;
    opening = false; recovering = false; dirty = false;
    startQueue();
    if (attemptedOpen && previous.active) {
      try {
        const restored = await loadHostedFile(false);
        if (restored) await open(restored, new URL(location.pathname + '?' + query, location.origin));
        markHostedClean();
      } catch {
        // Never allow partially opened geometry to overwrite the old file after a failed rollback.
        if (active) active = {...active, writable:false};
        queue?.dispose(); queue = null; opening = false; dirty = false;
        throw new Error("The tab could not open and the previous view could not be restored. Reload before editing.");
      }
    }
    throw error;
  }
}

export async function loadHostedFile(updateAddress = true): Promise<File | null> {
  if (query.has('example')) {
    saveRecovery?.dispose(); saveRecovery=null; queue?.dispose(); queue=null; dirty=false;
    opening = true;
    try {
      const {openExample}=await import('./examples/open-example');
      const loaded=await openExample(query);active=null;activeProject=loaded.project;
      activePartId=query.get('part');activeDrawingId=null;linkedPartReadOnly=true;
      if(updateAddress)history.replaceState(null,'',location.pathname+'?'+query);
      return loaded.file;
    } finally { opening=false; }
  }
  const id = query.get("document");
  if (!hostedCAD) return null;
  opening = true;
  owner = await sessionOwner(false);
  draftID = query.get("draft") ?? crypto.randomUUID();
  if (!id) {
    query.set("draft", draftID);
    history.replaceState(null, "", location.pathname + "?" + query);
    const recovered = await restoreFile(null);
    if (!recovered) opening = false;
    return recovered;
  }
  active = await request(query.has("revision") ? "read_revision" : "read", {
    id,
    ...(query.has("revision") ? { revision: Number(query.get("revision")) } : {}),
    branch: query.get("branch") ?? undefined,
  });
  if (isProjectFile(active.name)) {
    const result = (await request("project_read", {
      id,
      revision: active.revision,
      branch: query.get("branch") ?? undefined,
    })) as StoredFile & { project: Project };
    activeProject = result.project;
    if (query.has("drawing")) {
      const drawing = activeProject.drawings?.find(item => item.id === query.get("drawing"));
      if (!drawing) throw Error("This Drawing is not present in the selected design revision.");
      activeDrawingId = drawing.id;
      return restoreBytes(drawing.name + ".acdrw", new TextEncoder().encode(JSON.stringify(drawing.document)));
    }
    if (query.has("assembly") && !activeProject.assemblies.some(item => item.id === query.get("assembly"))) throw new Error("This Assembly is not present in the selected project revision.");
    if (
      query.has("part") &&
      !activeProject.parts.some((p) => p.id === query.get("part"))
    )
      throw new Error(
        "This Part is not present in the selected project revision.",
      );
    const part =
      query.has("assembly") ||
      (/\.acasm$/i.test(active.name) && !query.has("part"))
        ? null
        : (activeProject.parts.find((p) => p.id === query.get("part")) ??
          activeProject.parts.find((p) => p.document));
    if (part?.document) {
      activePartId = part.id;
      linkedPartReadOnly = part.source?.kind === "linked";
      return restoreBytes(part.name + ".acpart", new TextEncoder().encode(JSON.stringify(part.document)));
    }
  }
  if (activeProject && !query.has("assembly") && activeProject.assemblies[0]) {
    query.set("assembly", activeProject.assemblies[0].id);
    if (updateAddress) history.replaceState(null, "", location.pathname + "?" + query);
  }
  const bytes = Uint8Array.from(atob(active.data_base64!), (c) =>
    c.charCodeAt(0),
  );
  return restoreBytes(active.name, bytes);
}
function restoreBytes(name: string, bytes: Uint8Array): File | null {
  return restoreFile(new File([new Uint8Array(bytes)], name), snapshotText({name, bytes}));
}
function restoreFile(file: File | null, text = ''): File | null {
  const selection = prepareSaveRecovery<StoredFile | null>(keyFor(active), text);
  const recovery = selection.record;
  startQueue(text, selection);
  if (!recovery) return file;
  const value: Draft = JSON.parse(recovery.text);
  if (typeof value.name !== 'string' || !Array.isArray(value.data)) throw Error('The recovery copy could not be read. It has been retained.');
  recovering = true;
  queue!.pause(true);
  queue!.recover(recovery, active?.revision !== recovery.base?.revision);
  if (active?.writable !== false && (active || !recovery.blocked || [401,403].includes(recovery.blockedStatus ?? 0)))
    queue!.reconcile(fileIdentity(active), text, active?.revision === recovery.base?.revision);
  return new File([new Uint8Array(value.data)], value.name);
}
export async function saveHostedFile(name: string, bytes: Uint8Array): Promise<void> {
  if (query.has('example')) throw Error('Use Save to My files to create an editable copy of this example.');
  if (!queue) { owner = await sessionOwner(false); draftID ||= crypto.randomUUID(); startQueue(); }
  queue!.pause(false);
  queue!.write(snapshotText({ name, bytes }), !active);
  await queue!.flush();
  if (queue!.dirty) await queue!.flush();
  if (queue!.dirty) throw Error("The design still has unsaved changes.");
}
async function persistHostedFile(
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  if (saving) throw new Error("A save is already in progress.");
  saving = true;
  try {
    if (activeDrawingId && active && isDrawingFile(name)) {
      if (query.has("revision")) throw Error("This design revision is read-only.");
      const { persistDesignDrawing } = await import("./design/hosted-drawings");
      const result = await persistDesignDrawing(active, query.get("branch") ?? undefined,
        parseDrawingDocument(new TextDecoder().decode(bytes)), activeDrawingId);
      active = result.file; activeProject = result.project;
      return;
    }
    if (activePartId && active && isPartFile(name)) {
      if (!active.writable || linkedPartReadOnly)
        throw new Error(
          "This Part is read-only. Edit the original source or create a standalone copy.",
        );
      const result = (await request("project_edit", {
        id: active.id,
        expected_revision: active.revision,
        branch: query.get("branch") ?? undefined,
        operation: "save_part",
        part_id: activePartId,
        document: JSON.parse(new TextDecoder().decode(bytes)),
      })) as StoredFile & { project: Project };
      active = result;
      activeProject = result.project;
      return;
    }
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const data_base64 = btoa(binary);
    const sameType =
      active &&
      ((isPartFile(active.name) && isPartFile(name)) ||
        (isProjectFile(active.name) && isProjectFile(name)) ||
        (isDrawingFile(active.name) && isDrawingFile(name)) ||
        active.name.split(".").at(-1) === name.split(".").at(-1));
    if (active && sameType) {
      if (!active.writable)
        throw new Error(
          "This shared file is read-only. Use Make a copy in My files from CAD Home to edit your own copy.",
        );
      active = await request("save", {
        id: active.id,
        expected_revision: active.revision,
        data_base64,
        branch: query.get("branch") ?? undefined,
      });
    } else {
      active = await request("create", {
        name,
        data_base64,
        parent: query.get("folder"),
        scope: query.get("scope") === "workspace" ? "workspace" : "personal",
      });
      activeProject = null; activePartId = null; activeDrawingId = null; linkedPartReadOnly = false;
      for (const key of ["part", "assembly", "drawing", "branch", "revision"]) query.delete(key);
    }
    query.set('document',active.id);query.delete('draft');query.delete('new');
    history.replaceState(null,'',`${location.pathname}?${query}`);
    window.dispatchEvent(new Event("cad-document-saved"));
  } finally {
    saving = false;
  }
}

export async function listHostedParts(): Promise<
  { id: string; name: string; revision: number }[]
> {
  const groups = await Promise.all(
    ["personal", "workspace"].map(async (view) => {
      const response = await fetch("/api/library/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: "cad", query: ".", view }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result.files as { id: string; name: string; revision: number }[];
    }),
  );
  return [
    ...new Map(
      groups
        .flat()
        .filter((f) => isPartFile(f.name))
        .map((f) => [f.id, f]),
    ).values(),
  ];
}

export async function updateHostedLink(partId: string) {
  const part = activeProject?.parts.find((p) => p.id === partId);
  const match = part?.source?.asset_ref?.match(/^library:([a-f0-9]+)@(\d+)$/);
  if (!part || !match)
    throw new Error("The original server source is unavailable.");
  const source = await request("read", { id: match[1] });
  if (source.revision === Number(match[2]))
    throw new Error("This link already uses the latest saved revision.");
  return editHostedProject("update_link", part.name, {
    part_id: partId,
    source_id: source.id,
    source_revision: source.revision,
  });
}
