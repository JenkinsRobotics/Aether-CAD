/** A replay cache restored from its binary B-rep snapshot builds exactly what a cold build does:
 *  the same meshes, topology references, body identities and exact measures, unchanged and
 *  after an edit, while replaying only sketches and the changed tail. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { parsePartDocument } from "../document/part-serialization";
import type { ImportedModelData } from "../contracts/index";
import type { PartDocument } from "../document/index";
import { solidMeasures } from "./node-kernel";
import { cachedSteps, evaluatePartDocument, resetEvaluationCache, restoreEvaluation, snapshotEvaluation } from "./part-evaluator";

beforeAll(async () => { setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) })); }, 60000);

const robot = parsePartDocument(readFileSync(new URL("../../../scripts/examples/scifirobot/generated/Scifirobot.acpart", import.meta.url), "utf8"));
const sketches = (document: PartDocument) => document.features.filter((f) => f.type === "profile" || f.type === "sketch").length;

/** Builds are long and synchronous; let the test runner's own messages through between them. */
const breathe = () => new Promise((resolve) => setTimeout(resolve));
function build(document: PartDocument) {
  let measures: unknown[] = [];
  const model = evaluatePartDocument(structuredClone(document), { withBodies: (bodies) => { measures = [...bodies].map(([id, body]) => [id, solidMeasures(body)]); } });
  return { replayed: model.replayedFeatures, result: comparable(model), measures };
}
// Normals compare by value: a restored face may give an exact zero component the other sign.
const comparable = ({ parseMilliseconds: _, replayedFeatures: __, ...model }: ImportedModelData) =>
  ({ ...model, parts: model.parts.map((part) => ({ ...part, normals: part.normals.map((n) => n + 0) })) });
/** Through structured clone, as IndexedDB stores it. */
const reopen = (document: PartDocument) => {
  const snapshot = structuredClone(snapshotEvaluation(document)!);
  resetEvaluationCache();
  return { snapshot, restored: restoreEvaluation(document, snapshot) };
};

it("restores Scifirobot's exact steps and builds identically, unchanged and after an edit", async () => {
  resetEvaluationCache();
  const cold = build(robot);
  await breathe();
  expect(cold.replayed).toBe(robot.features.length);

  const { snapshot, restored } = reopen(robot);
  expect(restored).toBe(robot.features.length);
  expect(snapshot.shapes.length).toBeGreaterThan(0);
  const reopened = build(robot);
  await breathe();
  expect(reopened.replayed).toBe(sketches(robot));
  expect(reopened.measures).toEqual(cold.measures);
  expect(reopened.result).toEqual(cold.result);

  // Reopen, then edit the last extrusion: only sketches and the changed tail replay.
  const edited = structuredClone(robot);
  const at = edited.features.map((f) => f.type).lastIndexOf("extrude");
  Object.assign(edited.features[at], { distanceMillimeters: (edited.features[at] as { distanceMillimeters: number }).distanceMillimeters + 0.5 });
  resetEvaluationCache();
  expect(restoreEvaluation(edited, snapshot)).toBe(at);
  const restoredEdit = build(edited);
  await breathe();
  resetEvaluationCache();
  const coldEdit = build(edited);
  expect(restoredEdit.replayed).toBe(sketches({ ...robot, features: robot.features.slice(0, at) }) + robot.features.length - at);
  expect(restoredEdit.measures).toEqual(coldEdit.measures);
  expect(restoredEdit.result).toEqual(coldEdit.result);
  // The cache after the edit is an ordinary one: the next build replays nothing.
  expect(build(edited).replayed).toBe(0);
  resetEvaluationCache();
}, 300000);

it("restores nothing from damaged, foreign or diverging snapshots", () => {
  const profile = (id: string, offsetMillimeters: number, contour: object) => ({ id, name: id, type: "profile", plane: "XY", offsetMillimeters, suppressed: false, profile: { type: "drawing", contours: [contour] } });
  const extrude = (id: string, profileFeatureId: string, distanceMillimeters: number, operation: string) => ({ id, name: id, type: "extrude", profileFeatureId, distanceMillimeters, operation, suppressed: false });
  const small = { ...robot, documentId: "replay-small", features: [
    profile("base", 0, { type: "path", start: [-50, -30], segments: [[50, -30], [50, 30], [-50, 30], [-50, -30]].map((end) => ({ type: "line", end })) }),
    extrude("pad", "base", 10, "new"),
    profile("bore", 10, { type: "circle", center: [0, 0], radius: 3 }),
    extrude("cut", "bore", 10, "cut"),
  ] } as unknown as PartDocument;
  resetEvaluationCache();
  const cold = build(small);
  const { snapshot } = reopen(small);
  resetEvaluationCache();

  const damaged = structuredClone(snapshot);
  damaged.shapes[damaged.shapes.length - 1] = damaged.shapes[damaged.shapes.length - 1].slice(0, 40);
  expect(restoreEvaluation(small, damaged)).toBe(0);
  expect(cachedSteps(small.documentId)).toBe(0);
  expect(restoreEvaluation({ ...small, documentId: "other" }, snapshot)).toBe(0);
  expect(restoreEvaluation(small, { ...snapshot, source: "{" })).toBe(0);
  expect(restoreEvaluation(small, { ...snapshot, steps: snapshot.steps.map((step) => ({ ...step, key: "x" })) })).toBe(0);

  // A changed feature keeps only the steps before it; the rest replays.
  const changed = structuredClone(small);
  Object.assign(changed.features[3], { distanceMillimeters: 5 });
  expect(restoreEvaluation(changed, snapshot)).toBe(3);
  expect(build(changed).replayed).toBe(3);
  resetEvaluationCache();
  expect(build(small).result).toEqual(cold.result);
  resetEvaluationCache();
});
