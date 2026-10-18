import { afterEach, describe, expect, it, vi } from "vitest";
import type { PartDocument } from "@aether/core/document";
import type { ImportedModelData } from "../domain";
import { CADTestController, geometrySignature } from "./controller";
import { createSprocketDocument, defaultSprocketParameters, reopenTestDocument, stageDocument } from "./sprocket";

const model = (document: PartDocument, offset = 0): ImportedModelData => ({ sourceName: document.name, parseMilliseconds: 1,
  parts: document.rollbackIndex === 0 ? [] : [{ id: "test-sprocket-body", name: "Sprocket", sourceName: document.name, sourceDocumentId: document.documentId,
    vertices: new Float32Array([offset, 0, 0, 1, 0, 0, 0, 1, document.rollbackIndex ?? 20]), normals: new Float32Array(9), triangles: new Uint32Array([0, 1, 2]), edgeLines: new Float32Array(), faceRanges: [], topology: [] }],
});
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const controllers: CADTestController[] = [];
const make = (evaluate = vi.fn(async (document: PartDocument) => model(document))) => { const controller = new CADTestController(evaluate); controllers.push(controller); return { controller, evaluate }; };
afterEach(() => { controllers.forEach(controller => controller.dispose()); controllers.length = 0; vi.useRealTimers(); });

describe("CAD test window's real-document control path", () => {
  it("retains all canonical features and rollback when saving a partial build", () => {
    const sample = createSprocketDocument();
    for (let stage = 0; stage <= 7; stage++) {
      const document = stageDocument(sample.document, sample.stages, stage);
      const opened = reopenTestDocument(document);
      expect(opened.features).toEqual(sample.document.features);
      expect(opened.rollbackIndex).toBe(stage === 0 ? 0 : sample.stages[stage - 1].endIndex);
    }
    expect(() => stageDocument(sample.document, sample.stages, 8)).toThrow();
    expect(() => createSprocketDocument({ ...defaultSprocketParameters, teeth: 10.5 })).toThrow("whole number");
    expect(() => createSprocketDocument({ ...defaultSprocketParameters, heightMillimeters: NaN })).toThrow();
  });
  it("coalesces drag requests, keeps one native job active and ignores a stale completion", async () => {
    const jobs: { document: PartDocument; resolve: (value: ImportedModelData) => void }[] = [];
    const evaluate = vi.fn((document: PartDocument) => new Promise<ImportedModelData>(resolve => jobs.push({ document, resolve })));
    const { controller } = make(evaluate);
    controller.start(); controller.setStage(1); controller.setStage(2); controller.setStage(3);
    expect(evaluate).toHaveBeenCalledTimes(1);
    jobs[0].resolve(model(jobs[0].document)); await tick();
    expect(controller.snapshot()).toMatchObject({ stage: 3, status: "building", model: null });
    expect(jobs).toHaveLength(2);
    expect(jobs[1].document.rollbackIndex).toBe(controller.snapshot().stages[2].endIndex);
    jobs[1].resolve(model(jobs[1].document)); await tick();
    expect(controller.snapshot()).toMatchObject({ stage: 3, status: "ready" });
  });
  it("reuses only evaluated geometry in the current revision and invalidates it on edit", async () => {
    const { controller, evaluate } = make(); controller.start(); await tick();
    controller.setStage(3); await tick(); controller.setStage(7); await tick();
    expect(evaluate).toHaveBeenCalledTimes(2); expect(controller.snapshot().cached).toBe(true);
    controller.changeParameters({ ...defaultSprocketParameters, teeth: 11 }); await tick();
    expect(evaluate).toHaveBeenCalledTimes(3); expect(controller.snapshot().cached).toBe(false);
    expect(controller.snapshot().stages[1].name).toContain("11");
    const doc = evaluate.mock.calls[2][0];
    expect(doc.features.find(feature => feature.id === "teeth")).toMatchObject({ count: 11 });
    controller.undo(); await tick(); expect(controller.snapshot().parameters.teeth).toBe(13);
    controller.redo(); await tick(); expect(controller.snapshot().parameters.teeth).toBe(11);
  });
  it("rejects an invalid edit without losing the last valid document or undo history", async () => {
    const { controller } = make(); controller.start(); await tick(); const before = controller.snapshot();
    expect(() => controller.changeParameters({ ...before.parameters, boreDiameterMillimeters: 100 })).toThrow();
    expect(controller.snapshot()).toBe(before);
  });
  it("waits for rebuilds during playback, and pause cancels subsequent steps", async () => {
    vi.useFakeTimers(); const { controller, evaluate } = make(); controller.play(); await tick();
    expect(controller.snapshot()).toMatchObject({ stage: 0, playing: true });
    await vi.advanceTimersByTimeAsync(800); expect(controller.snapshot().stage).toBe(1);
    controller.pause(); const calls = evaluate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000); expect(evaluate).toHaveBeenCalledTimes(calls);
    expect(controller.snapshot().playing).toBe(false);
  });
  it("runs all rollback states and a fresh serialization/rebuild before passing checks", async () => {
    vi.useFakeTimers(); const { controller, evaluate } = make(); controller.runChecks(); await vi.runAllTimersAsync();
    expect(controller.snapshot()).toMatchObject({ stage: 7, checks: "passed", checking: false, checkedStages: 8 });
    expect(evaluate).toHaveBeenCalledTimes(9);
    expect(evaluate.mock.calls[8][0]).not.toBe(evaluate.mock.calls[7][0]);
    expect(evaluate.mock.calls[8][0]).toEqual(evaluate.mock.calls[7][0]);
  });
  it("reports native failure instead of passing a partial check", async () => {
    vi.useFakeTimers(); const { controller } = make(vi.fn(async document => { if ((document.rollbackIndex ?? 0) > 2) throw new Error("Native pocket failed"); return model(document); }));
    controller.runChecks(); await vi.runAllTimersAsync();
    expect(controller.snapshot()).toMatchObject({ checks: "failed", status: "error", error: "Native pocket failed", model: null, checking: false });
  });
  it("fails save/reopen if geometry changed despite a successful backend response", async () => {
    const evaluate = vi.fn(async (document: PartDocument) => model(document, evaluate.mock.calls.length));
    const { controller } = make(evaluate); controller.start(); await tick(); controller.reopen(); await tick();
    expect(controller.snapshot().status).toBe("error"); expect(controller.snapshot().error).toContain("different renderer payload");
  });
  it("does not publish a late result or queued requests after disposal", async () => {
    let finish!: (value: ImportedModelData) => void;
    const { controller, evaluate } = make(vi.fn(document => new Promise<ImportedModelData>(resolve => { finish = value => resolve({ ...value, sourceName: document.name }); })));
    const listener = vi.fn(); controller.subscribe(listener); controller.start(); controller.setStage(2);
    controller.dispose(); listener.mockClear(); finish(model(controller.currentDocument())); await tick();
    expect(evaluate).toHaveBeenCalledTimes(1); expect(listener).not.toHaveBeenCalled();
  });
  it("compares triangle connectivity as well as rounded positions on reopen", () => {
    const sample = createSprocketDocument(); const a = model(sample.document), b = model(sample.document);
    b.parts[0].triangles = new Uint32Array([0, 2, 1]);
    expect(geometrySignature(a)).not.toBe(geometrySignature(b));
  });
});
