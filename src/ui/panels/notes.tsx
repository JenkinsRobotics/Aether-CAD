/** Comments, persisted document 3D/PMI notes (with live 3D viewport pins), and action items panels. */
import { useState, useSyncExternalStore } from "react";
import { AetherIcon, Button, Checkbox, EmptyState, FieldRow, InspectorActions, InspectorSection, SegmentedControl, SelectField } from "@aether/ui";
import type { DocumentNote } from "@aether/core/document";
import { cadSelection } from "../../core/stores/cad-selection-store";
import { MockNote } from "./shared";
import "../CADInspector.css";

interface NotesStoreState {
  notes: readonly DocumentNote[];
  selectedId: string | null;
  pinsVisible: boolean;
  onMutate?: (notes: DocumentNote[]) => void;
}

const listeners = new Set<() => void>();
let state: NotesStoreState = { notes: [], selectedId: null, pinsVisible: true };

function emit() {
  for (const listener of listeners) listener();
}

/** Query the 3D viewport for the world coordinates of the current CAD selection (face/edge/vertex/body). */
export function resolveSelected3DAnchor(): { positionMillimeters: [number, number, number]; targetBodyId?: string } | null {
  const first = cadSelection.snapshot().items[0];
  if (!first) return null;
  let origin: [number, number, number] | null = null;
  window.dispatchEvent(
    new CustomEvent("aether-measure-frame", {
      detail: {
        item: first,
        respond: (frame: { origin?: [number, number, number] } | null) => {
          if (frame?.origin && frame.origin.length === 3 && frame.origin.every(Number.isFinite)) {
            origin = [
              Math.round(frame.origin[0] * 1000) / 1000,
              Math.round(frame.origin[1] * 1000) / 1000,
              Math.round(frame.origin[2] * 1000) / 1000,
            ];
          }
        },
      },
    }),
  );
  if (!origin) return null;
  return { positionMillimeters: origin, ...(first.partId ? { targetBodyId: first.partId } : {}) };
}

/** Reactive bridge syncing DocumentNotesPanel and the 3D viewport pin overlay with PartDocument.notes. */
export const documentNotesBridge = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot(): readonly DocumentNote[] {
    return state.notes;
  },
  viewSnapshot(): NotesStoreState {
    return state;
  },
  bind(notes: readonly DocumentNote[], onMutate?: (next: DocumentNote[]) => void): void {
    const selectedId = state.selectedId && notes.some((n) => n.id === state.selectedId) ? state.selectedId : null;
    state = { ...state, notes: [...notes], selectedId, onMutate };
    emit();
  },
  select(id: string | null): void {
    if (state.selectedId === id) return;
    state = { ...state, selectedId: id };
    emit();
  },
  setPinsVisible(visible: boolean): void {
    if (state.pinsVisible === visible) return;
    state = { ...state, pinsVisible: visible };
    emit();
  },
  add(
    text: string,
    category: DocumentNote["category"] = "note",
    positionMillimeters?: [number, number, number],
    targetBodyId?: string,
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const used = new Set(state.notes.map((n) => n.id));
    let id = `note-${state.notes.length + 1}`;
    while (used.has(id)) id += "-1";
    const next: DocumentNote[] = [
      ...state.notes,
      {
        id,
        text: trimmed,
        category,
        resolved: false,
        createdAt: new Date().toISOString(),
        ...(positionMillimeters ? { positionMillimeters } : {}),
        ...(targetBodyId ? { targetBodyId } : {}),
      },
    ];
    state = { ...state, notes: next, selectedId: id };
    state.onMutate?.(next);
    emit();
  },
  updateAnchor(id: string, positionMillimeters?: [number, number, number], targetBodyId?: string): void {
    const next = state.notes.map((n) => {
      if (n.id !== id) return n;
      const updated: DocumentNote = { ...n };
      if (positionMillimeters) updated.positionMillimeters = positionMillimeters;
      else delete updated.positionMillimeters;
      if (targetBodyId) updated.targetBodyId = targetBodyId;
      else if (!positionMillimeters) delete updated.targetBodyId;
      return updated;
    });
    state = { ...state, notes: next };
    state.onMutate?.(next);
    emit();
  },
  toggleResolved(id: string): void {
    const next = state.notes.map((n) => (n.id === id ? { ...n, resolved: !n.resolved } : n));
    state = { ...state, notes: next };
    state.onMutate?.(next);
    emit();
  },
  remove(id: string): void {
    const next = state.notes.filter((n) => n.id !== id);
    state = { ...state, notes: next, selectedId: state.selectedId === id ? null : state.selectedId };
    state.onMutate?.(next);
    emit();
  },
};

const CATEGORY_OPTIONS: { value: NonNullable<DocumentNote["category"]>; label: string }[] = [
  { value: "note", label: "General note" },
  { value: "pmi", label: "PMI / manufacturing" },
  { value: "callout", label: "3D callout" },
  { value: "review", label: "Design review" },
];

export function CommentsPanel() {
  return (
    <section className="cad-mock-panel" aria-label="Comments">
      <div className="cad-mock-toolbar"><Button disabled title="Planned — not functional yet">All ▾</Button><Button disabled title="Planned — not functional yet">Unresolved ▾</Button></div>
      <textarea className="cad-mock-input" placeholder="Add comment" rows={3} disabled />
      <div className="cad-mock-toolbar"><Button primary disabled>Add</Button><Button disabled>Cancel</Button></div>
      <MockNote />
    </section>
  );
}

export function DocumentNotesPanel() {
  const viewState = useSyncExternalStore(
    documentNotesBridge.subscribe,
    documentNotesBridge.viewSnapshot,
    documentNotesBridge.viewSnapshot,
  );
  const { notes, selectedId, pinsVisible } = viewState;
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<NonNullable<DocumentNote["category"]>>("note");
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [anchorText, setAnchorText] = useState("");
  const [anchorBodyId, setAnchorBodyId] = useState<string | undefined>(undefined);
  const [anchorNotice, setAnchorNotice] = useState("");

  const parseAnchor = (raw: string): [number, number, number] | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const nums = trimmed.split(/[,\s]+/).map(Number);
    if (nums.length === 3 && nums.every(Number.isFinite)) return [nums[0], nums[1], nums[2]];
    return undefined;
  };

  const handleAnchorToSelection = () => {
    const resolved = resolveSelected3DAnchor();
    if (!resolved) {
      setAnchorNotice("Select a face, edge, or vertex in the 3D viewport first.");
      return;
    }
    setAnchorText(resolved.positionMillimeters.map((v) => v.toFixed(2)).join(", "));
    setAnchorBodyId(resolved.targetBodyId);
    setAnchorNotice(`Pinned to ${resolved.positionMillimeters.map((v) => v.toFixed(1)).join(", ")} mm`);
  };

  const handleAdd = () => {
    if (!draft.trim()) return;
    const pos = parseAnchor(anchorText);
    if (anchorText.trim() && !pos) {
      setAnchorNotice("Enter 3D anchor as x, y, z (mm) or leave blank.");
      return;
    }
    documentNotesBridge.add(draft, category, pos, anchorBodyId);
    setDraft("");
    setAnchorText("");
    setAnchorBodyId(undefined);
    setAnchorNotice("");
  };

  const visible = notes.filter((n) =>
    filter === "all" ? true : filter === "open" ? !n.resolved : Boolean(n.resolved),
  );

  return (
    <section className="cad-property-sheet cad-notes-panel" aria-label="Document notes" data-panel="notes">
      <InspectorSection defaultOpen title="New 3D / PMI note">
        <FieldRow label="Category" htmlFor="doc-note-category">
          <SelectField
            id="doc-note-category"
            aria-label="Note category"
            value={category}
            options={CATEGORY_OPTIONS}
            onChange={(e) => setCategory(e.target.value as NonNullable<DocumentNote["category"]>)}
          />
        </FieldRow>
        <FieldRow label="3D Anchor (mm)" htmlFor="doc-note-anchor">
          <input
            id="doc-note-anchor"
            className="cad-input"
            aria-label="3D anchor position (x, y, z mm)"
            placeholder="Optional: x, y, z"
            value={anchorText}
            onChange={(e) => { setAnchorText(e.target.value); setAnchorNotice(""); }}
          />
        </FieldRow>
        <textarea
          className="cad-textarea"
          aria-label="New document note"
          placeholder="Add design note, PMI callout, or manufacturing instruction..."
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {anchorNotice && <p className="cad-form-note" role="status">{anchorNotice}</p>}
        <InspectorActions>
          <Button onClick={handleAnchorToSelection}>Pin to 3D selection</Button>
          <Button primary disabled={!draft.trim()} onClick={handleAdd}>Add note</Button>
        </InspectorActions>
      </InspectorSection>

      <InspectorSection defaultOpen title={`Saved notes (${notes.length})`}>
        <Checkbox
          label="Show 3D viewport pins"
          checked={pinsVisible}
          onChange={(e) => documentNotesBridge.setPinsVisible(e.target.checked)}
        />
        {notes.length > 0 && (
          <SegmentedControl
            ariaLabel="Filter notes"
            value={filter}
            options={[
              { id: "all", label: `All (${notes.length})` },
              { id: "open", label: `Open (${notes.filter((n) => !n.resolved).length})` },
              { id: "resolved", label: `Resolved (${notes.filter((n) => n.resolved).length})` },
            ]}
            onChange={(id) => setFilter(id as typeof filter)}
          />
        )}
        {visible.length === 0 ? (
          <EmptyState
            title={notes.length === 0 ? "No document notes" : "No matching notes"}
            description={
              notes.length === 0
                ? "Add instructions, 3D callouts, or PMI notes above. Pinned notes render as live callouts in the 3D viewport."
                : "Change the status filter above to see other notes."
            }
          />
        ) : (
          <ul className="cad-inspector-card-list" aria-label="Document notes list">
            {visible.map((n) => (
              <li
                key={n.id}
                className="cad-inspector-card"
                data-note-id={n.id}
                data-resolved={n.resolved ? "true" : "false"}
                data-selected={selectedId === n.id ? "true" : "false"}
                onClick={() => documentNotesBridge.select(n.id)}
              >
                <div className="cad-inspector-card-header">
                  <span className={`cad-pill ${n.category === "pmi" ? "cad-pill--accent" : ""}`}>
                    {(n.category ?? "note").toUpperCase()}
                  </span>
                  <span className={`cad-pill ${n.resolved ? "cad-pill--ok" : "cad-pill--warn"}`}>
                    {n.resolved ? "Resolved" : "Open"}
                  </span>
                </div>
                <p className="cad-inspector-card-body">{n.text}</p>
                {n.positionMillimeters && (
                  <span className="cad-inspector-card-meta">
                    3D Pin: {n.positionMillimeters.map((v) => v.toFixed(1)).join(", ")} mm
                  </span>
                )}
                <div className="cad-inspector-card-actions">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (n.positionMillimeters) {
                        documentNotesBridge.updateAnchor(n.id, undefined);
                      } else {
                        const resolved = resolveSelected3DAnchor();
                        if (resolved) documentNotesBridge.updateAnchor(n.id, resolved.positionMillimeters, resolved.targetBodyId);
                        else setAnchorNotice("Select a face, edge, or vertex in the 3D viewport to pin this note.");
                      }
                    }}
                  >
                    {n.positionMillimeters ? "Unpin" : "Pin to 3D"}
                  </Button>
                  <Button onClick={(e) => { e.stopPropagation(); documentNotesBridge.toggleResolved(n.id); }}>
                    {n.resolved ? "Reopen" : "Resolve"}
                  </Button>
                  <Button onClick={(e) => { e.stopPropagation(); documentNotesBridge.remove(n.id); }}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
    </section>
  );
}

export function ActionItemsPanel() {
  return (
    <section className="cad-mock-panel" aria-label="Action items">
      <input className="cad-mock-input" type="search" placeholder="Search in Action items" aria-label="Search in Action items" disabled />
      <div className="cad-mock-toolbar"><Button disabled title="Planned — not functional yet">Type ▾</Button><Button disabled title="Planned — not functional yet">Status ▾</Button><Button disabled title="Planned — not functional yet">Assignee ▾</Button></div>
      <div className="cad-mock-empty"><AetherIcon name="tasks" /><p>No action items found for the current filter.</p></div>
      <MockNote />
    </section>
  );
}
