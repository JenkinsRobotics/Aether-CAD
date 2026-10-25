import { applyDrawingCommand, buildDrawing, createDrawingDocument, parseDrawingDocument, serializeDrawingDocument, type BuiltDrawing, type DrawingCommand, type DrawingDocument, type DrawingProjector } from "@aether/core/drawing";
import type { PartDocument } from "@aether/core/document";
import { CADDrawingWorkspaceStore, cadDrawingWorkspace } from "../cad-drawing-workspace-store";
import { aetherKernel } from "../engine/aether/kernel";
import { drawingPresentation } from "./presentation";

export interface DrawingEditGuard { signal?: AbortSignal; assertCurrent?: () => void }
export interface DrawingEditorSession {
  writable?: () => boolean;
  contextKey?: () => string;
  changed?: (kind: "opened" | "edited") => void;
  readSource?: (drawing: DrawingDocument) => Promise<PartDocument>;
}
/** Transaction boundary shared by controls and automation. Failed geometry,
 * cancellation and document switches never replace the last good drawing. */
export class DrawingEditor {
  private current: BuiltDrawing | null = null;
  private past: DrawingDocument[] = [];
  private future: DrawingDocument[] = [];
  private busy = false;
  private viewedSheetId: string | null = null;
  private source: () => PartDocument | null = () => null;
  private session: DrawingEditorSession = {};
  constructor(private readonly store: CADDrawingWorkspaceStore, private readonly project: DrawingProjector) {}
  configure(source: () => PartDocument | null, session: DrawingEditorSession = {}): void { this.source = source; this.session = session; }
  snapshot(): BuiltDrawing | null { return this.current; }
  writable(): boolean { return this.session.writable?.() ?? true; }
  displayedSheetId(): string | undefined { return this.viewedSheetId ?? this.current?.document.activeSheetId; }
  async selectSheet(sheetId: string): Promise<void> {
    if (this.busy) throw Error("A drawing rebuild is already running.");
    if (!this.requireDocument().sheets.some(sheet => sheet.id === sheetId)) throw Error("Drawing sheet does not exist.");
    if (this.writable()) await this.execute({ type: "select-sheet", sheetId });
    else { this.viewedSheetId = sheetId; this.publish(); }
  }
  history(): { canUndo: boolean; canRedo: boolean; busy: boolean } { return { canUndo: this.past.length > 0, canRedo: this.future.length > 0, busy: this.busy }; }
  async enter(): Promise<void> {
    if (this.current) { this.publish(); return; }
    const source = this.source();
    if (!source) { this.store.setUnavailable("Open a Part to create its drawing, or open a saved drawing file."); return; }
    await this.openDocument(createDrawingDocument(source));
  }
  async create(): Promise<void> {
    const source = this.source(); if (!source) throw Error("Open a source Part first.");
    await this.openDocument(createDrawingDocument(source));
  }
  async open(text: string): Promise<void> { await this.openDocument(parseDrawingDocument(text)); }
  serialize(): string { if (!this.current) throw Error("No drawing is open."); return serializeDrawingDocument(this.current.document); }
  async refresh(guard: DrawingEditGuard = {}): Promise<void> {
    const previous = this.requireDocument();
    await this.transaction(async () => {
      const source = this.session.readSource ? await this.session.readSource(previous) : this.source();
      if (!source) throw Error("Open the source Part to refresh its drawing.");
      return applyDrawingCommand(previous, { type: "refresh-source", source });
    }, () => { this.past.push(previous); this.future = []; }, "edited", guard);
  }
  async execute(command: DrawingCommand, guard: DrawingEditGuard = {}): Promise<void> {
    const previous = this.requireDocument();
    await this.transaction(() => applyDrawingCommand(previous, command), () => { this.past.push(previous); this.future = []; }, "edited", guard);
  }
  async travel(direction: -1 | 1, guard: DrawingEditGuard = {}): Promise<void> {
    const from = direction < 0 ? this.past : this.future, to = direction < 0 ? this.future : this.past;
    const candidate = from.at(-1); if (!candidate || !this.current) return;
    const previous = this.current.document;
    await this.transaction(() => candidate, () => { from.pop(); to.push(previous); }, "edited", guard);
  }
  private requireDocument(): DrawingDocument { if (!this.current) throw Error("No drawing is open."); return this.current.document; }
  private async openDocument(document: DrawingDocument): Promise<void> {
    await this.transaction(() => document, () => { this.past = []; this.future = []; }, "opened");
  }
  private async transaction(candidateDocument: () => DrawingDocument | Promise<DrawingDocument>, commit: () => void, kind: "opened" | "edited", guard: DrawingEditGuard = {}): Promise<void> {
    if (this.busy) throw Error("A drawing rebuild is already running.");
    const before = this.current, context = this.session.contextKey?.();
    const check = () => {
      guard.signal?.throwIfAborted(); guard.assertCurrent?.();
      if (this.current !== before || this.session.contextKey?.() !== context) throw Error("The active drawing changed. No edit was applied.");
      if (kind === "edited" && !this.writable()) throw Error("This drawing is read-only or another editor is active.");
    };
    check(); this.busy = true; this.store.setLoading("Rebuilding drawing views…");
    try {
      const pending = candidateDocument();
      const document = pending instanceof Promise ? await pending : pending; check();
      const candidate = await buildDrawing(document, this.project); check();
      commit(); this.current = candidate; this.viewedSheetId = null; this.busy = false; this.publish();
    } catch (error) {
      this.busy = false;
      if (this.current) this.publish(); else this.store.setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally { this.busy = false; }
    this.session.changed?.(kind);
  }
  private publish(): void {
    const built = this.current!;
    const count = built.sheets.reduce((n, sheet) => n + sheet.views.length, 0);
    const source = this.source();
    const stale = source?.documentId === built.document.source.documentId && JSON.stringify(source) !== JSON.stringify(built.document.source);
    const presentation = { ...drawingPresentation(built), active_sheet_id: this.displayedSheetId()! };
    const projection = stale ? { ...presentation, sheets: presentation.sheets.map(sheet => ({ ...sheet, views: sheet.views.map(view => ({ ...view, state: "stale" as const })) })) } : presentation;
    this.store.setReady(projection, { drawing_id: built.document.documentId, revision: built.revision, status: stale ? "stale" : "current", completed_view_count: count, total_view_count: count, cancellable: false, diagnostic_ids: [] }, stale ? "Source Part changed. Rebuild to update views and dimensions." : undefined);
  }
}
export const drawingEditor = new DrawingEditor(cadDrawingWorkspace, (document, options) => aetherKernel().projectDrawing(document, options));
