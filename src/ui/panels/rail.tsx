import { cadSelection } from '../../core/stores/cad-selection-store';
import { studioAgentService } from '@aether/session/agent';
import { studioAgentAccessService } from '@aether/session/agent-access';
import { withReviewAgent } from "@aether/session/review-agent";
import { useLiveEditorAccess } from "@aether/session/LiveEditorAccess";
import { navigateDocument } from "../../app/document-navigation";
/**
 * The left rail's remaining panels (Jonathan, 2026-10-02): Create version,
 * Reminders, AI advisor and Part manager. Each is wired to something real —
 * the host's version action, the document's bodies, the agent API — rather
 * than drawn as a mock. Reminders persist on this device only, and say so.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AetherIcon, Button, EmptyState, FieldRow, IconButton, InspectorActions, InspectorSection, TextField, WorkspaceAgent } from "@aether/ui";
import { DocumentFileManager, type DocumentConnection, type FileManagerItem } from "@aether/ui";
import type { AssistantMessage } from "@aether/ui/concept-widgets";
import { cadPresentation } from "../../core/stores/cad-presentation-store";
import { cadAgentContext, cadAgentInteraction, subscribeCADAgent } from '../../automation/live-workspace';
import { cadReadOnlyInteraction } from '../../ai/read-only-tools';
import {cadAgentContextText} from '../../ai/agent-context';
import "../CADInspector.css";

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
      const { commitHosted } = await import("../../app/host-library");
      await commitHosted(name.trim(), message.trim());
      setStatus({ ok: true, text: `Version ${name.trim()} created.` });
      setName(""); setMessage("");
    } catch (e) { setStatus({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="cad-rail-panel cad-property-sheet" aria-label="Create version">
      <InspectorSection defaultOpen title="Create version">
        {hosted ? (
          <form className="cad-rail-form" onSubmit={(e) => void submit(e)}>
            <FieldRow label="Name" htmlFor="cad-version-name">
              <TextField id="cad-version-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="V1" maxLength={80} required />
            </FieldRow>
            <FieldRow label="Description" htmlFor="cad-version-desc" layout="stacked">
              <textarea id="cad-version-desc" className="cad-textarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What this version is for" maxLength={500} rows={3} />
            </FieldRow>
            <InspectorActions>
              <Button primary type="submit" disabled={busy || !name.trim()}>Create</Button>
            </InspectorActions>
            {status ? <p className={`cad-callout ${status.ok ? "cad-callout--ok" : "cad-callout--error"}`} role="status">{status.text}</p> : null}
          </form>
        ) : (
          <EmptyState
            title="Local draft"
            description="Save this document to your server to name versions of it."
          />
        )}
      </InspectorSection>
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
    <section className="cad-rail-panel cad-property-sheet" aria-label="Reminders">
      <InspectorSection defaultOpen title={`Reminders${items.length ? ` (${items.length})` : ""}`}>
        <form className="cad-rail-form" onSubmit={add}>
          <div className="cad-inline-edit-row">
            <TextField value={text} onChange={(e) => setText(e.target.value)} placeholder="Remind me to…" aria-label="Reminder" maxLength={200} />
            <IconButton label="Add reminder" type="submit" disabled={!text.trim()}><AetherIcon name="plus" /></IconButton>
          </div>
          <FieldRow label="Due date" htmlFor="cad-reminder-due">
            <TextField id="cad-reminder-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          </FieldRow>
        </form>
        {sorted.length ? (
          <ul className="cad-rail-list cad-inspector-card-list">
            {sorted.map((item) => (
              <li key={item.id} className="cad-inspector-card" data-done={item.done || undefined} data-resolved={item.done ? "true" : "false"} data-overdue={(!item.done && item.due && item.due < today) || undefined}>
                <div className="cad-inspector-card-header">
                  <label className="cad-inline-edit-row" style={{ flex: 1 }}>
                    <input type="checkbox" checked={item.done} onChange={() => setItems((c) => c.map((r) => (r.id === item.id ? { ...r, done: !r.done } : r)))} />
                    <span className="cad-inspector-card-body">{item.text}</span>
                  </label>
                  {item.due ? <span className={`cad-pill ${!item.done && item.due < today ? "cad-pill--error" : ""}`}>{item.due}</span> : null}
                  <IconButton size="small" label={`Remove ${item.text}`} onClick={() => setItems((c) => c.filter((r) => r.id !== item.id))}><AetherIcon name="close" /></IconButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No reminders"
            description="Nothing yet. Reminders stay on this device, with this document."
          />
        )}
      </InspectorSection>
    </section>
  );
}

// ---- AI advisor -------------------------------------------------------------

export function AdvisorPanel({connection}: {connection?:DocumentConnection}) {
  const currentConnection=useRef(connection); currentConnection.current=connection;
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const selection=useSyncExternalStore(cadSelection.subscribe,cadSelection.snapshot,cadSelection.snapshot);
  const selectionLabel=selection.items.length===1?selection.items[0].label:selection.items.length?`${selection.items.length} selected`:null;
  const agentContext = useSyncExternalStore(subscribeCADAgent,cadAgentContext,cadAgentContext);
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  // What the advisor is told about the document, so its answers are about this
  // part rather than parts in general.
  const productInteraction=cadAgentInteraction(agentContext);
  const interaction=cadReadOnlyInteraction(withReviewAgent(productInteraction,()=>currentConnection.current??null));
  const sharing=useLiveEditorAccess({app:'cad',documentID:documentID(),interaction:productInteraction});
  const context=cadAgentContextText(presentation.documentName,presentation.workspaceMode,interaction)+`\nCurrent selection: ${JSON.stringify(selection.items.map(({id,kind,partId,label})=>({id,kind,partId,label})))}`;
  return (
    <section className="cad-rail-panel cad-rail-panel--fill cad-rail-panel--agent" aria-label="AI advisor">
      <WorkspaceAgent service={studioAgentService} access={studioAgentAccessService} sharing={sharing} app="cad" interaction={interaction} contextText={context} detail={selectionLabel??presentation.documentName} messages={messages} onMessages={setMessages} />
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
const KIND_LABEL: Record<string, string> = { part: "Part Studio", assembly: "Assembly", drawing: "Drawing", mixed: "Document" };

/**
 * Both halves of what Jonathan asked for (2026-10-03): Onshape's tab manager,
 * listing the parts and assemblies this project is made of, over Fusion's
 * directory tree showing where the project lives. The shared widget draws
 * both; this supplies them from the project projection and the library.
 */
export function PartManagerPanel({ connection, onOpened }: { connection: DocumentConnection; onOpened?: () => void }) {
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const [project, setProject] = useState<{ kind?: string; parts: { id: string; name: string }[]; assemblies: { id: string; name: string }[] } | null>(null);
  // One file type: the label comes from what the open document holds.
  const documentKind = (name: string) => /\.aethercad$/i.test(name) ? KIND_LABEL[project?.kind ?? "mixed"] : "File";
  const search = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const documentID = search.get("document");
  const activeID = search.get("part") ?? search.get("assembly") ?? documentID;
  useEffect(() => {
    let disposed = false;
    void import("../../app/host-library").then(({ activeProject }) => { if (!disposed) setProject(activeProject); });
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
