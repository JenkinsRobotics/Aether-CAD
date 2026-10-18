import { documentRequest } from "@aether/session/documents";
import { AutosaveSession, readRecovery, recoveryKey, sessionOwner } from "@aether/session/autosave";
import { configureDocumentSession } from "./document-session";
import { isPartFile, isProjectFile } from "@aether/core/document/file-types";
import type { AssemblyProjectionV1 } from './cad-assembly-bridge';
/** Hosted file transport only; document interpretation stays in Core. */
export const hostedCAD = location.pathname.startsWith("/cad/");
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
};
export let activeProject: Project | null = null;
/** Refresh project tabs from the active canonical archive after an assembly
 * edit. Persistence still serializes that archive through the normal save path. */
export function syncHostedAssemblyProject(projection: AssemblyProjectionV1): void {
  if (!activeProject || activeProject.id !== projection.workspace_id) return;
  activeProject = {...activeProject,
    parts:projection.part_definitions.map(part=>({id:part.id,name:part.name,document:part.feature_document,
      source:{kind:part.source.kind,label:part.source.label,asset_ref:part.source.asset_ref??undefined}})),
    assemblies:projection.assemblies.map(assembly=>({id:assembly.id,name:assembly.name})),
  };
}
/** Saved container name, distinct from the active Part Studio name. */
export function hostedDocumentName(): string | null { return active?.name ?? null; }
let activePartId: string | null = null;
let linkedPartReadOnly = false;
/** Live editor automation observes the same linked/revision access as saving. */
export function hostedPartEditable(): boolean {
  return !hostedCAD || (!opening && !linkedPartReadOnly && active?.writable !== false && !query.has('revision'));
}
export async function editHostedProject(
  operation: string,
  name: string,
  extra: object = {},
) {
  if (dirty)
    throw new Error("Save your current work before changing project items.");
  if (!active?.writable) throw new Error("This project is read-only.");
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
export function projectItemURL(id: string, kind: "part" | "assembly") {
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
let opening = false;
let recovering = false;
let capture: Promise<void> | null = null;
let captureSerial = 0;
let draftID = "";
const snapshotText = (value: Snapshot) => JSON.stringify({ name: value.name, data: Array.from(value.bytes) });
function keyFor(file: StoredFile | null) {
  const scope = [file?.id ?? draftID, activePartId ?? query.get("assembly") ?? "", query.get("branch") ?? "", query.get("revision") ?? ""].join(":");
  return recoveryKey("cad", owner, scope);
}
function fileIdentity(file: StoredFile | null): StoredFile | null {
  if (!file) return null;
  const { id, name, revision, writable } = file; return { id, name, revision, writable };
}
function startQueue(text = "") {
  queue?.dispose();
  queue = new AutosaveSession({ key: keyFor(active), base: fileIdentity(active), text, keyForBase: keyFor,
    save: async (text, base) => {
      active = base;
      const value: Draft = JSON.parse(text);
      await persistHostedFile(value.name, new Uint8Array(value.data));
      return fileIdentity(active);
    },
  });
  queue.subscribe(state => {
    if (queue?.dirty) dirty = true;
    else if (!capture) dirty = false;
    document.dispatchEvent(new CustomEvent("aether-save-state", { detail: state }));
  });
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
}
/** Save the current snapshot as a new personal document, including conflict recovery. */
export async function copyHostedSnapshot() {
  if(capture)await capture;
  const current=snapshot?.();
  if(!current)throw new Error('Wait for the current document snapshot before making a copy.');
  let raw='';for(let i=0;i<current.bytes.length;i+=8192)raw+=String.fromCharCode(...current.bytes.subarray(i,i+8192));
  const file=await request('create',{name:current.name.replace(/(\.[^.]+)$/,' copy$1'),scope:'personal',data_base64:btoa(raw)});
  queue?.dispose();location.assign(`/cad/index.html?document=${encodeURIComponent(file.id)}`);
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
  if (opening) return;
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
  linkedPartReadOnly = false;
  document.querySelector(".project-tabs")?.remove();
  draftID = crypto.randomUUID();
  query.delete("document"); query.set("draft", draftID);
  history.replaceState(null, "", location.pathname + "?draft=" + draftID);
  if (owner) startQueue();
}
/** Switch transport identity transactionally after the old document is saved. */
export async function switchHostedDocument(url: URL, open: (file: File, url: URL) => Promise<void>) {
  await flushAutosaveNow();
  const previous = { active, activeProject, activePartId, linkedPartReadOnly, query, draftID };
  let attemptedOpen = false;
  try {
    query = new URLSearchParams(url.search);
    active = null; activeProject = null; activePartId = null; linkedPartReadOnly = false;
    const file = await loadHostedFile(false);
    if (!file) throw new Error("This tab has no saved document.");
    attemptedOpen = true;
    await open(file, url);
    markHostedClean();
    url.search = query.toString();
  } catch (error) {
    active = previous.active; activeProject = previous.activeProject;
    activePartId = previous.activePartId; linkedPartReadOnly = previous.linkedPartReadOnly;
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
  const id = query.get("document");
  if (!hostedCAD) return null;
  opening = true;
  owner = await sessionOwner();
  draftID = query.get("draft") ?? crypto.randomUUID();
  if (!id) {
    query.set("draft", draftID);
    history.replaceState(null, "", location.pathname + "?" + query);
    const recovered = restoreFile(null);
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
      return restoreFile(new File([JSON.stringify(part.document)], part.name + ".acpart"));
    }
  }
  if (activeProject && !query.has("assembly") && activeProject.assemblies[0]) {
    query.set("assembly", activeProject.assemblies[0].id);
    if (updateAddress) history.replaceState(null, "", location.pathname + "?" + query);
  }
  const bytes = Uint8Array.from(atob(active.data_base64!), (c) =>
    c.charCodeAt(0),
  );
  return restoreFile(new File([bytes], active.name));
}
function restoreFile(file: File | null): File | null {
  const recovery = readRecovery<StoredFile | null>(keyFor(active));
  startQueue();
  if (!recovery) return file;
  const value: Draft = JSON.parse(recovery.text);
  recovering = true;
  queue!.pause(true); // resume only after the canonical editor has opened it
  queue!.recover(recovery, Boolean(active && active.revision !== recovery.base?.revision));
  return new File([new Uint8Array(value.data)], value.name);
}
export async function saveHostedFile(name: string, bytes: Uint8Array): Promise<void> {
  if (!queue) { owner = await sessionOwner(); draftID ||= crypto.randomUUID(); startQueue(); }
  queue!.pause(false);
  queue!.write(snapshotText({ name, bytes }), !active);
  await queue!.flush();
  if (queue!.dirty) await queue!.flush();
}
async function persistHostedFile(
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  if (saving) throw new Error("A save is already in progress.");
  saving = true;
  try {
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
    } else
      active = await request("create", {
        name,
        data_base64,
        parent: query.get("folder"),
        scope: query.get("scope") === "workspace" ? "workspace" : "personal",
      });
    const nextQuery=new URLSearchParams(location.search);
    nextQuery.set('document',active.id);nextQuery.delete('draft');nextQuery.delete('new');
    history.replaceState(null,'',`/cad/index.html?${nextQuery}`);
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
