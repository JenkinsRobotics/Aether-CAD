import type { PartDocument } from "@aether/core/document";
import type { ImportedModelData } from "../domain";
import { createSprocketDocument, defaultSprocketParameters, reopenTestDocument, stageDocument, type HistoryStage, type SprocketParameters } from "./sprocket";

export type NativePartEvaluator = (document: PartDocument) => Promise<ImportedModelData>;
export interface CADTestSnapshot {
  document: PartDocument;
  parameters: SprocketParameters;
  stages: HistoryStage[];
  stage: number;
  model: ImportedModelData | null;
  status: "building" | "ready" | "error";
  message: string;
  error: string | null;
  cached: boolean;
  playing: boolean;
  checking: boolean;
  checks: "idle" | "running" | "passed" | "failed";
  checkedStages: number;
  delayMilliseconds: number;
  canUndo: boolean;
  canRedo: boolean;
}

/** Diagnostic equality for save/reopen: topology counts and mesh positions.
 * This checks the renderer payload, not manufacturing tolerances or standards. */
export function geometrySignature(model: ImportedModelData): string {
  return JSON.stringify(model.parts.map(part => ({ id: part.id, faces: part.faceRanges.length, triangles: Array.from(part.triangles),
    vertices: Array.from(part.vertices, value => Math.round(value * 100000) / 100000),
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

/** One in-flight native build, plus only the latest queued request. A newer
 * rollback, edit or disposed window cannot be overwritten by a late result. */
export class CADTestController {
  private state: CADTestSnapshot;
  private listeners = new Set<() => void>();
  private cache = new Map<string, ImportedModelData>();
  private revision = 0;
  private generation = 0;
  private pending: { generation: number; revision: number; key: string; document: PartDocument; stage: number } | null = null;
  private active = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private roundtripSignature: string | null = null;
  private roundtripNote = false;
  private past: SprocketParameters[] = [];
  private future: SprocketParameters[] = [];

  constructor(private evaluate: NativePartEvaluator) {
    const sample = createSprocketDocument();
    this.state = { ...sample, parameters: { ...defaultSprocketParameters }, stage: sample.stages.length, model: null, status: "building", message: "Preparing native geometry…", error: null, cached: false, playing: false, checking: false, checks: "idle", checkedStages: 0, delayMilliseconds: 800, canUndo: false, canRedo: false };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<CADTestSnapshot>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private clearTimer() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  start() { this.request(this.state.stage); }
  pause() { this.clearTimer(); this.roundtripSignature = null; this.roundtripNote = false; this.patch({ playing: false, checking: false, ...(this.state.checking ? { checks: "idle", message: "Checks stopped." } : {}) }); }
  setStage(stage: number) { stageDocument(this.state.document, this.state.stages, stage); this.pause(); this.request(stage); }
  rebuild() { this.pause(); this.request(this.state.stage, true); }
  setDelay(delayMilliseconds: number) { if ([400, 800, 1600].includes(delayMilliseconds)) this.patch({ delayMilliseconds }); }
  play() {
    this.pause(); this.patch({ playing: true });
    this.request(this.state.stage >= this.state.stages.length ? 0 : this.state.stage);
  }
  runChecks() {
    this.pause(); this.patch({ checking: true, checks: "running", checkedStages: 0 });
    this.request(0, true);
  }
  reopen() {
    if (this.state.status !== "ready" || !this.state.model) return;
    this.pause();
    this.roundtripSignature = this.state.status === "ready" && this.state.model ? geometrySignature(this.state.model) : null;
    this.roundtripNote = true;
    this.roundtripDocument(); this.request(this.state.stage, true);
  }
  currentDocument() { return stageDocument(this.state.document, this.state.stages, this.state.stage); }
  private roundtripDocument() {
    const document = reopenTestDocument(this.currentDocument());
    this.revision++; this.cache.clear(); this.patch({ document });
  }
  changeParameters(parameters: SprocketParameters) {
    const sample = createSprocketDocument(parameters, this.state.document.documentId);
    this.pause(); this.past.push(this.state.parameters); this.past = this.past.slice(-30); this.future = [];
    this.setDocument(parameters, sample);
  }
  private setDocument(parameters: SprocketParameters, sample = createSprocketDocument(parameters, this.state.document.documentId)) {
    this.revision++; this.cache.clear();
    this.patch({ ...sample, parameters: { ...parameters }, checks: "idle", checkedStages: 0, canUndo: !!this.past.length, canRedo: !!this.future.length });
    this.request(this.state.stage, true);
  }
  undo() { const parameters = this.past.pop(); if (!parameters) return; this.pause(); this.future.push(this.state.parameters); this.setDocument(parameters); }
  redo() { const parameters = this.future.pop(); if (!parameters) return; this.pause(); this.past.push(this.state.parameters); this.setDocument(parameters); }
  reset() { this.pause(); this.changeParameters({ ...defaultSprocketParameters }); }
  dispose() { this.pause(); this.disposed = true; this.generation++; this.pending = null; this.listeners.clear(); this.cache.clear(); }

  private request(stage: number, force = false) {
    if (this.disposed) return;
    this.clearTimer();
    const document = stageDocument(this.state.document, this.state.stages, stage), generation = ++this.generation, key = `${this.revision}:${stage}`;
    this.pending = null;
    this.patch({ stage, status: "building", model: null, error: null, cached: false, message: `Rebuilding ${stage ? this.state.stages[stage - 1].name : "origin"}…` });
    const cached = !force && this.cache.get(key);
    if (cached) { this.accept(cached, true); return; }
    this.pending = { generation, revision: this.revision, key, document, stage };
    void this.pump();
  }
  private async pump() {
    if (this.active || this.disposed) return;
    this.active = true;
    try {
      while (this.pending && !this.disposed) {
        const job = this.pending; this.pending = null;
        try {
          const model = await this.evaluate(job.document);
          if (job.revision === this.revision && !this.disposed) this.cache.set(job.key, model);
          if (job.generation === this.generation && !this.disposed) this.accept(model, false);
        } catch (error) {
          if (job.generation !== this.generation || this.disposed) continue;
          this.clearTimer();
          this.patch({ status: "error", model: null, error: error instanceof Error ? error.message : String(error), message: "Native rebuild failed.", playing: false, checking: false, checks: this.state.checking ? "failed" : this.state.checks });
        }
      }
    } finally { this.active = false; }
  }
  private accept(model: ImportedModelData, cached: boolean) {
    if (this.roundtripSignature && geometrySignature(model) !== this.roundtripSignature) throw new Error("Save/reopen rebuilt a different renderer payload. Check the geometry diagnostics.");
    const reopened = this.roundtripNote;
    this.roundtripNote = false; this.roundtripSignature = null;
    this.patch({ model, status: "ready", cached, error: null, message: reopened ? "Saved, reopened and rebuilt. Geometry matches." : `${this.state.stage ? this.state.stages[this.state.stage - 1].name : "Origin"} · ${cached ? "evaluated geometry from this session" : "native rebuild complete"}.` });
    if (this.state.checking) {
      const expected = this.state.stage ? 1 : 0;
      if (model.parts.length !== expected) throw new Error(`Expected ${expected} bodies at stage ${this.state.stage}; received ${model.parts.length}.`);
      if (reopened) { this.patch({ checking: false, checks: "passed", message: "Checks passed: 8 rollback states + save/reopen + native rebuild." }); return; }
      this.patch({ checkedStages: this.state.checkedStages + 1 });
      if (this.state.stage === this.state.stages.length) {
        this.roundtripSignature = geometrySignature(model); this.roundtripNote = true; this.roundtripDocument();
        this.timer = setTimeout(() => this.request(this.state.stage, true), 100);
      } else this.timer = setTimeout(() => this.request(this.state.stage + 1, true), 100);
    } else if (this.state.playing) {
      if (this.state.stage >= this.state.stages.length) { this.patch({ playing: false, message: "Build playback complete." }); return; }
      this.timer = setTimeout(() => this.request(this.state.stage + 1), this.state.delayMilliseconds);
    }
  }
}
