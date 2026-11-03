/** The Drawing workspace route. */
import { cadDrawingWorkspace } from "../../cad-drawing-workspace-store";
import { DrawingWorkspace } from "../DrawingWorkspace";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@aether/ui";
import { exportDrawingDXF, exportDrawingSVG } from "@aether/core/drawing";
import { drawingEditor } from "../../drawing/controller";
import { drawingFiles, downloadDrawingFile } from "../../drawing/files";
import { tabArchive } from "../../document/aethercad-archive";
import { drawingPDF } from "../../drawing/pdf-export";
import { DrawingAuthorDialog, type DrawingDialogDraft } from "../../drawing/DrawingAuthorDialog";
import type { DrawingPresentationCommandID } from "../../cad-drawing-presentation";

export function DrawingWorkspaceRoute({ active }: { active: boolean }) {
  const [draft, setDraft] = useState<DrawingDialogDraft | null>(null);
  const [error, setError] = useState("");
  const exportContext = useRef(0);
  // Invalidate before another async export can finish after a workspace switch.
  useLayoutEffect(() => {
    exportContext.current += 1;
    return () => { exportContext.current += 1; };
  }, [active]);
  const fileInput = useRef<HTMLInputElement>(null);
  const drawing = useSyncExternalStore(
    cadDrawingWorkspace.subscribe,
    cadDrawingWorkspace.snapshot,
    cadDrawingWorkspace.snapshot,
  );
  const built = drawingEditor.snapshot(), document = built?.document;
  const sheet = document?.sheets.find(s => s.id === drawingEditor.displayedSheetId());
  const selectedId = drawing.selectedEntityIDs.values().next().value;
  const selectedKind = selectedId === sheet?.id ? "sheet" : sheet?.views.some(v => v.id === selectedId) ? "view" : sheet?.annotations.some(a => a.id === selectedId) ? "annotation" : null;
  const history = drawingEditor.history();
  const editable = drawingEditor.writable();
  const run = async (action: () => Promise<void>) => { setError(""); try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const command = (id: DrawingPresentationCommandID) => {
    setError("");
    if (!editable && ["add-sheet", "add-view", "add-section", "add-annotation", "rebuild-drawing"].includes(id)) { setError("This drawing is read-only."); return; }
    if (id === "add-sheet" || id === "add-view" || id === "add-section" || id === "add-annotation") { setDraft({ kind: id === "add-sheet" ? "sheet" : id === "add-view" || id === "add-section" ? "view" : "annotation", section: id === "add-section" }); return; }
    if (id === "rebuild-drawing") { void run(() => drawingEditor.refresh()); return; }
    if (id === "add-bom") { if (!editable) { setError("This drawing is read-only."); return; } if (sheet) void run(() => drawingEditor.execute({ type: "update-sheet", sheetId: sheet.id, partsList: sheet.partsList ? null : { originMm: [sheet.widthMm - 130, 20] } })); return; }
    if (!built) return;
    if (id === "save-workspace") void run(() => drawingFiles.save());
    if (id === "export-svg") downloadDrawingFile(`${built.document.name}.svg`, exportDrawingSVG(built, sheet?.id), "image/svg+xml");
    if (id === "export-dxf") downloadDrawingFile(`${built.document.name}.dxf`, exportDrawingDXF(built, sheet?.id), "application/dxf");
    if (id === "export-pdf" || id === "export-pdf-all") void run(async () => {
      const context = exportContext.current;
      const bytes = await drawingPDF(built, id === "export-pdf-all" ? undefined : sheet?.id, id === "export-pdf-all");
      if (!active || exportContext.current !== context || drawingEditor.snapshot() !== built) throw Error("The Drawing changed during PDF export. Export it again.");
      downloadDrawingFile(`${built.document.name}.pdf`, bytes, "application/pdf");
    });
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
      <Button disabled={history.busy} onClick={() => void run(() => drawingFiles.create())}>New from Part</Button>
      <Button disabled={history.busy} onClick={() => fileInput.current?.click()}>Open drawing</Button>
      <Button disabled={!editable || !history.canUndo || history.busy} onClick={() => void run(() => drawingEditor.travel(-1))}>Undo</Button>
      <Button disabled={!editable || !history.canRedo || history.busy} onClick={() => void run(() => drawingEditor.travel(1))}>Redo</Button>
      <Button disabled={!editable || !selectedKind || history.busy} onClick={() => { if (selectedKind) setDraft({ kind: selectedKind, editId: selectedId }); }}>Edit selection</Button>
      <Button disabled={!editable || !selectedKind || history.busy} onClick={() => { if (!sheet || !selectedId || !selectedKind) return; void run(() => drawingEditor.execute(selectedKind === "sheet" ? { type: "remove-sheet", sheetId: sheet.id } : selectedKind === "view" ? { type: "remove-view", sheetId: sheet.id, viewId: selectedId } : { type: "remove-annotation", sheetId: sheet.id, annotationId: selectedId })); }}>Delete</Button>
      <Button disabled={!built || history.busy} onClick={() => { if (built) { const archive = tabArchive(built.document, 'drawing'); downloadDrawingFile(archive.name, archive.bytes, 'application/vnd.aether.workspace+zip'); } }}>Download drawing</Button>
      {!editable && built && <span>Read-only drawing</span>}
      <input ref={fileInput} type="file" accept=".aethercad" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void run(() => drawingFiles.open(file)); }}/>
      {error && <span role="alert">{error}</span>}
    </div>
    <DrawingWorkspace
      snapshot={drawing}
      onAction={(action) => {
        cadDrawingWorkspace.dispatch(action);
        if (action.type === "select-entities") {
          const id = action.ids[0];
          const owner = document?.sheets.find(s => s.id === id || s.views.some(v => v.id === id) || s.annotations.some(a => a.id === id));
          if (owner && owner.id !== drawingEditor.displayedSheetId()) void run(() => drawingEditor.selectSheet(owner.id));
        }
      }}
      onCommand={command}
      commandsConnected={true}
      onExit={() => void run(() => drawingFiles.leave())}
    />
    {draft && document && <DrawingAuthorDialog draft={draft} document={document} execute={command => drawingEditor.execute(command)} onClose={() => setDraft(null)}/>}
  </div>;
}
