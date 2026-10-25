/** The Drawing workspace route. */
import { cadDrawingWorkspace } from "../../cad-drawing-workspace-store";
import { cadPresentation } from "../../cad-presentation-store";
import { DrawingWorkspace } from "../DrawingWorkspace";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@aether/ui";
import { exportDrawingDXF, exportDrawingSVG } from "@aether/core/drawing";
import { drawingEditor } from "../../drawing/controller";
import { DrawingAuthorDialog, type DrawingDialogDraft } from "../../drawing/DrawingAuthorDialog";
import type { DrawingPresentationCommandID } from "../../cad-drawing-presentation";

export function DrawingWorkspaceRoute({ active }: { active: boolean }) {
  const [draft, setDraft] = useState<DrawingDialogDraft | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const drawing = useSyncExternalStore(
    cadDrawingWorkspace.subscribe,
    cadDrawingWorkspace.snapshot,
    cadDrawingWorkspace.snapshot,
  );
  const built = drawingEditor.snapshot(), document = built?.document;
  const sheet = document?.sheets.find(s => s.id === document.activeSheetId);
  const selectedId = drawing.selectedEntityIDs.values().next().value;
  const selectedKind = selectedId === sheet?.id ? "sheet" : sheet?.views.some(v => v.id === selectedId) ? "view" : sheet?.annotations.some(a => a.id === selectedId) ? "annotation" : null;
  const history = drawingEditor.history();
  const run = async (action: () => Promise<void>) => { setError(""); try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type })), link = window.document.createElement("a");
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const command = (id: DrawingPresentationCommandID) => {
    setError("");
    if (id === "add-sheet" || id === "add-view" || id === "add-annotation") { setDraft({ kind: id === "add-sheet" ? "sheet" : id === "add-view" ? "view" : "annotation" }); return; }
    if (id === "rebuild-drawing") { void run(() => drawingEditor.refresh()); return; }
    if (!built) return;
    if (id === "save-workspace") download(`${built.document.name}.acdrawing`, drawingEditor.serialize(), "application/json");
    if (id === "export-svg") download(`${built.document.name}.svg`, exportDrawingSVG(built), "image/svg+xml");
    if (id === "export-dxf") download(`${built.document.name}.dxf`, exportDrawingDXF(built), "application/dxf");
  };
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || !["z", "s"].includes(event.key.toLowerCase())) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key.toLowerCase() === "z" && target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (window.document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === "s") command("save-workspace");
      else void run(() => drawingEditor.travel(event.shiftKey ? 1 : -1));
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  return <div
    className={`cad-drawing-route${active ? " active" : ""}`}
    aria-hidden={!active}
    inert={!active}
  >
    <div className="cad-drawing-filebar" aria-label="Drawing files and editing">
      <Button disabled={history.busy} onClick={() => void run(() => drawingEditor.create())}>New from Part</Button>
      <Button disabled={history.busy} onClick={() => fileInput.current?.click()}>Open drawing</Button>
      <Button disabled={!history.canUndo || history.busy} onClick={() => void run(() => drawingEditor.travel(-1))}>Undo</Button>
      <Button disabled={!history.canRedo || history.busy} onClick={() => void run(() => drawingEditor.travel(1))}>Redo</Button>
      <Button disabled={!selectedKind || history.busy} onClick={() => { if (selectedKind) setDraft({ kind: selectedKind, editId: selectedId }); }}>Edit selection</Button>
      <Button disabled={!selectedKind || history.busy} onClick={() => { if (!sheet || !selectedId || !selectedKind) return; void run(() => drawingEditor.execute(selectedKind === "sheet" ? { type: "remove-sheet", sheetId: sheet.id } : selectedKind === "view" ? { type: "remove-view", sheetId: sheet.id, viewId: selectedId } : { type: "remove-annotation", sheetId: sheet.id, annotationId: selectedId })); }}>Delete</Button>
      <input ref={fileInput} type="file" accept=".acdrawing,application/json" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void run(async () => { if (file.size > 32 * 1024 * 1024) throw Error("Drawing file exceeds 32 MiB."); await drawingEditor.open(await file.text()); }); }}/>
      {error && <span role="alert">{error}</span>}
    </div>
    <DrawingWorkspace
      snapshot={drawing}
      onAction={(action) => {
        cadDrawingWorkspace.dispatch(action);
        if (action.type === "select-entities") {
          const id = action.ids[0];
          const owner = document?.sheets.find(s => s.id === id || s.views.some(v => v.id === id) || s.annotations.some(a => a.id === id));
          if (owner && owner.id !== document?.activeSheetId) void run(() => drawingEditor.execute({ type: "select-sheet", sheetId: owner.id }));
        }
      }}
      onCommand={command}
      commandsConnected={true}
      onExit={() => cadPresentation.dispatch({ type: "select-workspace-mode", mode: "modeling" })}
    />
    {draft && document && <DrawingAuthorDialog draft={draft} document={document} execute={command => drawingEditor.execute(command)} onClose={() => setDraft(null)}/>}
  </div>;
}
