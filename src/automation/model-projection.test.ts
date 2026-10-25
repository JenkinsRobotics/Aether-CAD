import { expect, it, vi } from "vitest";
import { createEmptyPartDocument, serializePartDocument, type ProfileFeature, type PartDocument } from "@aether/core/document";
import type { SketchFrame, ModelProjectionOptions } from "@aether/core/sketch";
import { prepareModelProjection } from "./model-projection";
import { CADAgentEditor, type CADAgentWorkspace } from "./live-workspace";
import type { ImportedModelData } from "../domain";

function fixture() {
  const document = createEmptyPartDocument("Projection");
  const profile: ProfileFeature = { id: "sketch", type: "profile", name: "Sketch", plane: "XY", offsetMillimeters: 17, suppressed: false, profile: { type: "drawing", contours: [] } };
  document.features.push(profile);
  const model: ImportedModelData = { sourceName: "Projection", parts: [], parseMilliseconds: 1 };
  const result = { contours: [{ type: "circle" as const, center: [3, 4] as [number, number], radius: 5 }], approximatedEdges: [{ body_id: "body", face_id: -3, edge_index: 0 }], toleranceMillimeters: 0.01 };
  const kernel = { projectModelGeometry: vi.fn(async (_document: PartDocument, _frame: SketchFrame, _options?: ModelProjectionOptions) => result), evaluatePart: vi.fn(async () => model) };
  return { document, profile, model, result, kernel };
}
it("uses the same insertion as the UI, snapshots only earlier history and reports approximated copies", async () => {
  const f = fixture(), before = serializePartDocument(f.document);
  const result = await prepareModelProjection(f.document, { feature_id: "sketch", entities_json: '[{"body_id":"body","face_id":-3}]', construction: true }, f.kernel);
  expect(serializePartDocument(f.document)).toBe(before);
  expect(f.kernel.projectModelGeometry.mock.calls[0][0].features).toEqual([]);
  expect(f.kernel.projectModelGeometry).toHaveBeenCalledWith(expect.anything(), { originMillimeters: [0, 0, 17], xDirection: [1, 0, 0], normal: [0, 0, 1] }, { entities: [{ body_id: "body", face_id: -3 }] });
  expect((result.document.features[0] as ProfileFeature).profile).toMatchObject({ contours: [{ id: expect.any(String), construction: true }] });
  expect(result.projection).toMatchObject({ associative: false, added_contours: 1, tolerance_mm: 0.01, approximated_edges: f.result.approximatedEdges });
});
it("rejects malformed options, suppressed targets and rolled-back history before invoking the kernel", async () => {
  const f = fixture();
  for (const args of [{ feature_id: "absent" }, { feature_id: "sketch", entities_json: "[]" }, { feature_id: "sketch", entities_json: "{}" }, { feature_id: "sketch", tolerance_mm: NaN }, { feature_id: "sketch", construction: "true" }, { feature_id: "sketch", extra: true }])
    await expect(prepareModelProjection(f.document, args, f.kernel)).rejects.toThrow();
  f.profile.suppressed = true;
  await expect(prepareModelProjection(f.document, { feature_id: "sketch" }, f.kernel)).rejects.toThrow(/unsuppressed/);
  f.profile.suppressed = false; f.document.rollbackIndex = 0;
  await expect(prepareModelProjection(f.document, { feature_id: "sketch" }, f.kernel)).rejects.toThrow(/rollback/);
  expect(f.kernel.projectModelGeometry).not.toHaveBeenCalled();
});
it.each(["cancel", "switch", "edit", "read-only", "closed", "failure"])("refuses agent commit when %s occurs during projection", async mode => {
  const f = fixture(), controller = new AbortController();
  let key = "part", writable = true, available = true;
  const commit = vi.fn();
  const workspace: CADAgentWorkspace = { current: () => f.document, contextKey: () => key, available: () => available, writable: () => writable, evaluate: f.kernel.evaluatePart, projectModelGeometry: f.kernel.projectModelGeometry, commit, history: { candidate: () => null, commit: vi.fn() } };
  f.kernel.projectModelGeometry.mockImplementation(async () => {
    if (mode === "cancel") controller.abort();
    if (mode === "switch") key = "other";
    if (mode === "edit") f.document.name = "Changed";
    if (mode === "read-only") writable = false;
    if (mode === "closed") available = false;
    if (mode === "failure") throw Error("Missing source edge");
    return f.result;
  });
  await expect(new CADAgentEditor(workspace).execute("part", { id: "include", name: "aether_cad_sketch_include_model", arguments: { feature_id: "sketch" } }, controller.signal)).rejects.toThrow();
  expect(commit).not.toHaveBeenCalled();
  expect(f.kernel.evaluatePart).not.toHaveBeenCalled();
});
it("commits one qualified agent candidate and preserves its projection report", async () => {
  const f = fixture(), commit = vi.fn();
  const workspace: CADAgentWorkspace = { current: () => f.document, contextKey: () => "part", available: () => true, writable: () => true, evaluate: f.kernel.evaluatePart, projectModelGeometry: f.kernel.projectModelGeometry, commit, history: { candidate: () => null, commit: vi.fn() } };
  const result = await new CADAgentEditor(workspace).execute("part", { id: "include", name: "aether_cad_sketch_include_model", arguments: { feature_id: "sketch" } }, new AbortController().signal);
  expect(commit).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ changed: true, projection: { associative: false, added_contours: 1 } });
});
