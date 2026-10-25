import { applyDrawingCommand, buildDrawing, createDrawingDocument, parseDrawingDocument, serializeDrawingDocument, type BuiltDrawing, type DrawingCommand, type DrawingDocument, type DrawingProjector } from "@aether/core/drawing";
import type { PartDocument } from "@aether/core/document";
import { CADDrawingWorkspaceStore, cadDrawingWorkspace } from "../cad-drawing-workspace-store";
import { aetherKernel } from "../engine/aether/kernel";
import { drawingPresentation } from "./presentation";

/** Transaction boundary shared by controls and automation. Failed geometry never
 * replaces the last good drawing or advances its history. */
export class DrawingEditor {
  private current: BuiltDrawing | null = null;
  private past: DrawingDocument[] = [];
  private future: DrawingDocument[] = [];
  private busy = false;
  private source: () => PartDocument | null = () => null;
  constructor(private readonly store: CADDrawingWorkspaceStore, private readonly project: DrawingProjector) {}
  configure(source: () => PartDocument | null): void { this.source = source; }
  snapshot(): BuiltDrawing | null { return this.current; }
  history(): { canUndo: boolean; canRedo: boolean; busy: boolean } { return { canUndo: this.past.length > 0, canRedo: this.future.length > 0, busy: this.busy }; }
  async enter(): Promise<void> {
    if (this.current) { this.publish(); return; }
    const source = this.source();
    if (!source) { this.store.setUnavailable("Open a Part to create its drawing, or open a saved .acdrawing file."); return; }
    await this.openDocument(createDrawingDocument(source));
  }
  async create(): Promise<void> {
    const source = this.source(); if (!source) throw Error("Open a source Part first.");
    await this.openDocument(createDrawingDocument(source));
  }
  async open(text: string): Promise<void> { await this.openDocument(parseDrawingDocument(text)); }
  serialize(): string { if (!this.current) throw Error("No drawing is open."); return serializeDrawingDocument(this.current.document); }
  async refresh(): Promise<void> {
    const source = this.source(); if (!source) throw Error("Open the source Part to refresh its drawing.");
    await this.execute({ type: "refresh-source", source });
  }
  async execute(command: DrawingCommand): Promise<void> {
    if (!this.current) throw Error("No drawing is open.");
    const previous = this.current.document;
    await this.transaction(applyDrawingCommand(previous, command), () => { this.past.push(previous); this.future = []; });
  }
  async travel(direction: -1 | 1): Promise<void> {
    const from = direction < 0 ? this.past : this.future, to = direction < 0 ? this.future : this.past;
    const candidate = from.at(-1); if (!candidate || !this.current) return;
    const previous = this.current.document;
    await this.transaction(candidate, () => { from.pop(); to.push(previous); });
  }
  private async openDocument(document: DrawingDocument): Promise<void> {
    await this.transaction(document, () => { this.past = []; this.future = []; });
  }
  private async transaction(document: DrawingDocument, commit: () => void): Promise<void> {
    if (this.busy) throw Error("A drawing rebuild is already running.");
    this.busy = true; this.store.setLoading("Rebuilding drawing views…");
    try {
      const candidate = await buildDrawing(document, this.project);
      commit(); this.current = candidate; this.busy = false; this.publish();
    } catch (error) {
      this.busy = false;
      if (this.current) this.publish(); else this.store.setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally { this.busy = false; }
  }
  private publish(): void {
    const built = this.current!;
    const count = built.sheets.reduce((n, sheet) => n + sheet.views.length, 0);
    const source = this.source();
    const stale = source?.documentId === built.document.source.documentId && JSON.stringify(source) !== JSON.stringify(built.document.source);
    const presentation = drawingPresentation(built);
    const projection = stale ? { ...presentation, sheets: presentation.sheets.map(sheet => ({ ...sheet, views: sheet.views.map(view => ({ ...view, state: "stale" as const })) })) } : presentation;
    this.store.setReady(projection, { drawing_id: built.document.documentId, revision: built.revision, status: stale ? "stale" : "current", completed_view_count: count, total_view_count: count, cancellable: false, diagnostic_ids: [] }, stale ? "Source Part changed. Rebuild to update views and dimensions." : undefined);
  }
}
export const drawingEditor = new DrawingEditor(cadDrawingWorkspace, (document, options) => aetherKernel().projectDrawing(document, options));
