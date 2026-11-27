/** The Drawing workspace route. */
import { cadDrawingWorkspace } from "../../core/stores/cad-drawing-workspace-store";
import { DrawingWorkspace } from "../DrawingWorkspace";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@aether/ui";
import { auditDrawing, exportDrawingDXF, exportDrawingSVG } from "@aether/core/drawing";
import { drawingEditor } from "../../drawing/controller";
import { drawingFiles, downloadDrawingFile } from "../../drawing/files";
import { tabArchive } from "../../document/aethercad-archive";
import { drawingPDF } from "../../drawing/pdf-export";
import { DrawingAuthorDialog, type DrawingDialogDraft } from "../../drawing/DrawingAuthorDialog";
import { buildMoveAnnotationCommand, buildMoveViewCommand, buildPlacementCommand } from "../../drawing/canvas-interaction";
import type { DrawingPresentationCommandID } from "../../core/cad-drawing-presentation";

export function DrawingWorkspaceRoute({ active }: { active: boolean }) {
  const [draft, setDraft] = useState<DrawingDialogDraft | null>(null);
  const [error, setError] = useState("");
  const [auditBanner, setAuditBanner] = useState("");
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
    setAuditBanner("");
    if (!editable && ["add-sheet", "add-view", "add-standard-views", "add-section", "add-annotation", "import-dimensions", "rebuild-drawing"].includes(id)) { setError("This drawing is read-only."); return; }
    if (id === "add-sheet" || id === "add-view" || id === "add-section" || id === "add-annotation") { setDraft({ kind: id === "add-sheet" ? "sheet" : id === "add-view" || id === "add-section" ? "view" : "annotation", section: id === "add-section" }); return; }
    if (id === "add-standard-views") {
      if (!sheet) return;
      const cx = sheet.widthMm * 0.32, cy = sheet.heightMm * 0.62;
      const dx = sheet.widthMm * 0.28, dy = sheet.heightMm * 0.28;
      const used = new Set(sheet.views.map((v) => v.id));
      const unique = (base: string) => { let candidate = base, n = 1; while (used.has(candidate)) candidate = `${base}-${n++}`; used.add(candidate); return candidate; };
      const frontId = unique("view-front");
      void run(async () => {
        await drawingEditor.execute({ type: "add-view", sheetId: sheet.id, view: { id: frontId, name: "Front", orientation: "front", originMm: [cx, cy], scale: 1, hiddenLines: true } });
        await drawingEditor.execute({ type: "add-view", sheetId: sheet.id, view: { id: unique("view-top"), name: "Top", orientation: "top", parentId: frontId, originMm: [cx, cy - dy], scale: 1, hiddenLines: true } });
        await drawingEditor.execute({ type: "add-view", sheetId: sheet.id, view: { id: unique("view-right"), name: "Right", orientation: "right", parentId: frontId, originMm: [cx + dx, cy], scale: 1, hiddenLines: true } });
        await drawingEditor.execute({ type: "add-view", sheetId: sheet.id, view: { id: unique("view-iso"), name: "Isometric", orientation: "isometric", originMm: [cx + dx, cy - dy], scale: 0.85, hiddenLines: false } });
      });
      return;
    }
    if (id === "import-dimensions") {
      if (!sheet) return;
      const targetView = sheet.views.find((v) => v.id === selectedId) ?? sheet.views.find((v) => v.orientation !== "isometric") ?? sheet.views[0];
      if (!targetView) { setError("Add a drawing view before importing dimensions."); return; }
      const used = new Set(sheet.annotations.map((a) => a.id));
      const unique = (base: string) => { let candidate = base, n = 1; while (used.has(candidate)) candidate = `${base}-${n++}`; used.add(candidate); return candidate; };
      void run(async () => {
        if (!sheet.annotations.some((a) => a.kind === "width" && a.viewId === targetView.id)) {
          await drawingEditor.execute({ type: "add-annotation", sheetId: sheet.id, annotation: { id: unique(`${targetView.id}-width`), kind: "width", viewId: targetView.id, decimals: 2, positionMm: [targetView.originMm[0], targetView.originMm[1] - 32] } });
        }
        if (!sheet.annotations.some((a) => a.kind === "height" && a.viewId === targetView.id)) {
          await drawingEditor.execute({ type: "add-annotation", sheetId: sheet.id, annotation: { id: unique(`${targetView.id}-height`), kind: "height", viewId: targetView.id, decimals: 2, positionMm: [targetView.originMm[0] - 42, targetView.originMm[1]] } });
        }
      });
      return;
    }
    if (id === "audit-drawing") {
      if (!built) return;
      const report = auditDrawing(built);
      const errors = report.findings.filter((f) => f.severity === "error").length;
      const warnings = report.findings.filter((f) => f.severity === "warning").length;
      setAuditBanner(
        report.findings.length === 0
          ? "Drawing audit passed: 0 issues."
          : `Drawing audit: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${report.findings.length - errors - warnings} info.`,
      );
      return;
    }
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
      <input ref={fileInput} type="file" accept=".aethercad" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void run(() => drawingFiles.open(file)); }} />
      {auditBanner && <span role="status" className="cad-drawing-audit-status">{auditBanner}</span>}
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
      editable={editable && !history.busy}
      onMoveView={(viewId, deltaMm) => {
        if (!editable || !sheet) return;
        const view = sheet.views.find((v) => v.id === viewId);
        if (!view) return;
        void run(() => drawingEditor.execute(buildMoveViewCommand(sheet.id, view, deltaMm)));
      }}
      onMoveAnnotation={(annotationId, deltaMm) => {
        if (!editable || !sheet) return;
        const ann = sheet.annotations.find((a) => a.id === annotationId);
        if (!ann) return;
        void run(() => drawingEditor.execute(buildMoveAnnotationCommand(sheet.id, ann, deltaMm)));
      }}
      onPlaceAnnotation={(tool, pointsMm, snappedViewId) => {
        if (!editable || !document || !sheet) return;
        const sheetProj = drawing.projection?.sheets.find((s) => s.id === sheet.id);
        if (!sheetProj) return;
        void run(() => drawingEditor.execute(buildPlacementCommand(document, sheetProj, tool, pointsMm, snappedViewId)));
      }}
      onExit={() => void run(() => drawingFiles.leave())}
    />
    {draft && document && <DrawingAuthorDialog draft={draft} document={document} execute={command => drawingEditor.execute(command)} onClose={() => setDraft(null)} />}
  </div>;
}
