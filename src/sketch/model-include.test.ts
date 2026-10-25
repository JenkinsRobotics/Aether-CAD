import { expect, it, vi } from "vitest";
import { createEmptyPartDocument } from "@aether/core/document";
import { principalFrame } from "@aether/core/document";
import { appendModelContours, createModelIncludeController, modelBeforeSketch, type ModelIncludeSnapshot } from "./model-include";

function fixture() {
  let snapshot: ModelIncludeSnapshot | null = {
    document: createEmptyPartDocument("Include"), featureId: "sketch", frame: principalFrame("XY", 15),
    drawing: { type: "drawing", contours: [] }, construction: false, revision: "one",
  };
  const result = { contours: [{ type: "circle" as const, center: [3, 4] as [number, number], radius: 5 }], approximatedEdges: [], toleranceMillimeters: 0.01 };
  const kernel = { projectModelGeometry: vi.fn(async () => result), sketchSection: vi.fn(async () => result.contours) };
  const commit = vi.fn(), message = vi.fn();
  const controller = createModelIncludeController({ kernel: () => kernel, read: () => snapshot, commit, message });
  return { kernel, result, commit, message, controller, read: () => snapshot!, change: (change: (s: ModelIncludeSnapshot) => ModelIncludeSnapshot | null) => { snapshot = change(snapshot!); } };
}
it("shares validated immutable insertion, preserving constraints and assigning stable authored identities", () => {
  const source = { type: "drawing" as const, contours: [{ type: "path" as const, start: [0, 0] as [number, number], segments: [] }] };
  const next = appendModelContours(source, [{ type: "path", start: [1, 2], segments: [{ type: "line", end: [4, 5] }] }], true);
  expect(source.contours).toHaveLength(1);
  expect(next.contours[1]).toMatchObject({ id: expect.any(String), construction: true, startVertexId: expect.any(String), segments: [{ id: expect.any(String), endVertexId: expect.any(String) }] });
  expect(() => appendModelContours(source, [{ type: "circle", center: [0, 0], radius: -2 }], false)).toThrow();
  expect(() => appendModelContours(source, [], false)).toThrow();
  const copied = appendModelContours(source, [next.contours[1]], false).contours[1];
  expect(copied.id).not.toBe(next.contours[1].id);
  if (copied.type === 'path' && next.contours[1].type === 'path') {
    expect(copied.startVertexId).not.toBe(next.contours[1].startVertexId);
    expect(copied.segments[0].id).not.toBe(next.contours[1].segments[0].id);
  }
});
it("projects selected entities and keeps face auto-projection on the coplanar operation", async () => {
  const f = fixture(), entities = [{ body_id: "body", face_id: -12, edge_index: 0 }];
  await f.controller.include("project", { projection: { entities } });
  expect(f.kernel.projectModelGeometry).toHaveBeenCalledWith(expect.anything(), principalFrame("XY", 15), { entities });
  expect(f.commit).toHaveBeenCalledOnce();
  expect(f.message).toHaveBeenLastCalledWith(expect.stringContaining("editable copies"));
  await f.controller.include("edges", { construction: true });
  expect(f.kernel.sketchSection).toHaveBeenCalledWith(expect.anything(), principalFrame("XY", 15), "edges", undefined);
  expect(f.commit.mock.calls[1][0].contours[0].construction).toBe(true);
  expect(f.read().construction).toBe(false);
});
it.each(["draft", "plane", "revision", "closed", "dispose", "mutation"])("discards late output after %s changes without changing history", async mode => {
  const f = fixture();
  let resolve!: (value: typeof f.result) => void;
  f.kernel.projectModelGeometry.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = f.controller.include("project");
  if (mode === "draft") f.change(s => ({ ...s, drawing: structuredClone(s.drawing) }));
  if (mode === "plane") f.change(s => ({ ...s, frame: principalFrame("XZ", 1) }));
  if (mode === "revision") f.change(s => ({ ...s, revision: "two" }));
  if (mode === "closed") f.change(() => null);
  if (mode === "dispose") f.controller.dispose();
  if (mode === "mutation") f.read().drawing.contours.push({ type: "path", start: [1, 2], segments: [] });
  resolve(f.result); await pending;
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.message).toHaveBeenCalledTimes(1);
});
it("does not overlap requests and preserves the draft on kernel failure", async () => {
  const f = fixture();
  let reject!: (reason: Error) => void;
  f.kernel.projectModelGeometry.mockImplementation(() => new Promise((_done, fail) => { reject = fail; }));
  const pending = f.controller.include("project");
  await f.controller.include("project");
  expect(f.kernel.projectModelGeometry).toHaveBeenCalledOnce();
  reject(Error("Selected face no longer exists")); await pending;
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.message).toHaveBeenLastCalledWith("Selected face no longer exists");
});
it("excludes self/future and rolled-back features from projection inputs", () => {
  const document = createEmptyPartDocument("Part");
  document.features = ["a", "b", "c"].map(id => ({ id, name: id, type: "profile", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", centerMillimeters: [0, 0], radiusMillimeters: 5 } }));
  expect(modelBeforeSketch(document, "b").features.map(f => f.id)).toEqual(["a"]);
  document.rollbackIndex = 1;
  expect(modelBeforeSketch(document, "new").features.map(f => f.id)).toEqual(["a"]);
  expect(modelBeforeSketch(document, "c").features.map(f => f.id)).toEqual(["a"]);
  expect(document.features).toHaveLength(3);
});
