import { LiveEditorAccess } from "@aether/session/LiveEditorAccess";
import { navigateDocument } from "../../document-navigation";
/**
 * The left rail's remaining panels (Jonathan, 2026-10-02): Create version,
 * Reminders, AI advisor and Part manager. Each is wired to something real —
 * the host's version action, the document's bodies, the agent API — rather
 * than drawn as a mock. Reminders persist on this device only, and say so.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AetherIcon, Button, IconButton, WorkspaceAgent } from "@aether/ui";
import { DocumentFileManager, type DocumentConnection, type FileManagerItem } from "@aether/ui";
import type { AssistantMessage } from "@aether/ui/concept-widgets";
import { cadPresentation } from "../../cad-presentation-store";
import { cadAgentContext, cadAgentInteraction, subscribeCADAgent } from '../../automation/live-workspace';
import {cadAgentContextText} from '../../ai/agent-context';

const documentID = () => (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("document"));

// ---- Create version ---------------------------------------------------------

export function CreateVersionPanel() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const hosted = documentID() !== null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setStatus(null);
    try {
      // Loaded on use: the host library reads `location` as it initialises,
      // and this panel is also rendered to static HTML where there is none.
      const { commitHosted } = await import("../../host-library");
      await commitHosted(name.trim(), message.trim());
      setStatus({ ok: true, text: `Version ${name.trim()} created.` });
      setName(""); setMessage("");
    } catch (e) { setStatus({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="cad-rail-panel" aria-label="Create version">
      <h2>Create version</h2>
      {hosted ? (
        <form className="cad-rail-form" onSubmit={(e) => void submit(e)}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="V1" maxLength={80} required /></label>
          <label>Description<textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What this version is for" maxLength={500} rows={3} /></label>
          <div className="cad-rail-form-actions">
            <Button primary type="submit" disabled={busy || !name.trim()}>Create</Button>
          </div>
          {status ? <p className={status.ok ? "cad-rail-ok" : "cad-rail-error"} role="status">{status.text}</p> : null}
        </form>
      ) : <p className="cad-rail-dim">Save this document to your server to name versions of it.</p>}
    </section>
  );
}

// ---- Reminders --------------------------------------------------------------

type Reminder = { id: string; text: string; due: string; done: boolean };
const reminderKey = (doc: string | null) => `aether-cad.reminders.${doc ?? "draft"}`;

function readReminders(doc: string | null): Reminder[] {
  try { return JSON.parse(localStorage.getItem(reminderKey(doc)) ?? "[]"); } catch { return []; }
}

export function RemindersPanel() {
  const doc = documentID();
  const [items, setItems] = useState<Reminder[]>(() => readReminders(doc));
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  useEffect(() => { try { localStorage.setItem(reminderKey(doc), JSON.stringify(items)); } catch { /* device-only */ } }, [items, doc]);
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setItems((current) => [...current, { id: crypto.randomUUID(), text: text.trim(), due, done: false }]);
    setText(""); setDue("");
  };
  const today = new Date().toISOString().slice(0, 10);
  const sorted = useMemo(() => [...items].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9").localeCompare(b.due || "9")), [items]);
  return (
    <section className="cad-rail-panel" aria-label="Reminders">
      <h2>Reminders</h2>
      <form className="cad-rail-form cad-rail-form--row" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Remind me to…" aria-label="Reminder" maxLength={200} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <IconButton label="Add reminder" type="submit" disabled={!text.trim()}><AetherIcon name="plus" /></IconButton>
      </form>
      {sorted.length ? (
        <ul className="cad-rail-list">
          {sorted.map((item) => (
            <li key={item.id} data-done={item.done || undefined} data-overdue={(!item.done && item.due && item.due < today) || undefined}>
              <label>
                <input type="checkbox" checked={item.done} onChange={() => setItems((c) => c.map((r) => (r.id === item.id ? { ...r, done: !r.done } : r)))} />
                <span>{item.text}</span>
              </label>
              {item.due ? <small>{item.due}</small> : null}
              <IconButton label={`Remove ${item.text}`} onClick={() => setItems((c) => c.filter((r) => r.id !== item.id))}><AetherIcon name="close" /></IconButton>
            </li>
          ))}
        </ul>
      ) : <p className="cad-rail-dim">Nothing yet. Reminders stay on this device, with this document.</p>}
    </section>
  );
}

// ---- AI advisor -------------------------------------------------------------

/** The host's agent API, reached the way Studio reaches it. */
const agentService = {
  async call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`/api/agent/${action}`, {
      method: "POST", credentials: "same-origin", keepalive: action === "cancel",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? body.error ?? "The advisor is unavailable.");
    return body as T;
  },
};

export function AdvisorPanel() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const agentContext = useSyncExternalStore(subscribeCADAgent,cadAgentContext,cadAgentContext);
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  // What the advisor is told about the document, so its answers are about this
  // part rather than parts in general.
  const interaction=cadAgentInteraction(agentContext);
  const context=cadAgentContextText(presentation.documentName,presentation.workspaceMode,interaction);
  return (
    <section className="cad-rail-panel cad-rail-panel--fill" aria-label="AI advisor">
      <LiveEditorAccess app="cad" documentID={documentID()} interaction={interaction}/>
      <WorkspaceAgent service={agentService} app="cad" interaction={interaction} contextText={context} detail="Aether CAD AI" messages={messages} onMessages={setMessages}
        notice="Ask the agent to build, check or revise this model. Connect your provider through Plugins to begin." />
    </section>
  );
}

// ---- Part manager -----------------------------------------------------------



/**
 * What a document is, by its extension — the second line of every row, as in
 * the Onshape reference. The date is deliberately not shown: Jonathan,
 * 2026-10-03, "I don't care about date, I care about part type, name, and
 * version."
 */
const KIND_LABEL: Record<string, string> = {
  acpart: "Part Studio",
  acasm: "Assembly",
  acad: "Project",
  acdrw: "Drawing",
};
const documentKind = (name: string) => KIND_LABEL[name.split(".").pop()?.toLowerCase() ?? ""] ?? "Document";

/**
 * Both halves of what Jonathan asked for (2026-10-03): Onshape's tab manager,
 * listing the parts and assemblies this project is made of, over Fusion's
 * directory tree showing where the project lives. The shared widget draws
 * both; this supplies them from the project projection and the library.
 */
export function PartManagerPanel({ connection, onOpened }: { connection: DocumentConnection; onOpened?: () => void }) {
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const [project, setProject] = useState<{ parts: { id: string; name: string }[]; assemblies: { id: string; name: string }[] } | null>(null);
  const search = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const documentID = search.get("document");
  const activeID = search.get("part") ?? search.get("assembly") ?? documentID;
  useEffect(() => {
    let disposed = false;
    void import("../../host-library").then(({ activeProject }) => { if (!disposed) setProject(activeProject); });
    return () => { disposed = true; };
  }, [documentID, presentation.documentName]);
  const groups = project ? [
    { id: "parts", label: "Part studios", emptyText: "No parts in this project yet.",
      items: project.parts.map((part): FileManagerItem => ({ id: part.id, name: part.name, kind: "part", detail: "Part Studio" })) },
    { id: "assemblies", label: "Assemblies", emptyText: "No assemblies yet.",
      items: project.assemblies.map((assembly): FileManagerItem => ({ id: assembly.id, name: assembly.name, kind: "assembly", detail: "Assembly" })) },
  ] : documentID ? [{id:"document",label:"Open document",items:[{id:documentID,name:presentation.documentName,kind:"part" as const,detail:documentKind(presentation.documentName)}]}] : [];
  return <DocumentFileManager connection={connection} documentGroups={groups} activeID={activeID} fileType={documentKind}
    onOpenItem={async item => {
      if (item.id === documentID) { onOpened?.(); return; }
      await connection.flush();
      await navigateDocument(`/cad/index.html?document=${encodeURIComponent(documentID!)}&${item.kind}=${encodeURIComponent(item.id)}`);
      onOpened?.();
    }} />;
}
