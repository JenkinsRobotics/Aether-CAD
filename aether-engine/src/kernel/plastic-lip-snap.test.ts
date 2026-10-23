import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { createRectanglePartDocument } from "../document/part-document";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);
const volume = (d: ReturnType<typeof createRectanglePartDocument>) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };

it("raises a lip inside a shelled rim and sinks a groove outside it", () => {
  const box = createRectanglePartDocument("Housing", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0], extrudeId = box.features[1].id;
  const shelled = { ...box, features: [...box.features, { id: "sh", type: "shell", name: "Shell", suppressed: false, thicknessMillimeters: 1, removedFaces: [{ sourceFeatureId: extrudeId, bodyId: built.id, label: "Top", normal: [0, 0, 1] }] } as never] };
  const hollow = volume(shelled);
  const rim = { sourceFeatureId: "sh", bodyId: built.id, label: "Rim", normal: [0, 0, 1] as [number, number, number], faceAnchor: { centerMillimeters: [0, 0, 10], areaSquareMillimeters: 96 } };
  const lip = { ...shelled, features: [...shelled.features, { id: "lip", type: "lip", name: "Lip", suppressed: false, targetBodyId: built.id, face: rim, shape: "lip", side: "inside", widthMillimeters: 0.5, heightMillimeters: 2 } as never] };
  // Inner rim 28 × 18: a 0.5 mm band with sharp corners (29 × 19 − 28 × 18 = 47 mm²), 2 mm tall: 94 mm³.
  const added = volume(lip) - hollow;
  expect(added).toBeCloseTo(94, 3);
  const groove = { ...shelled, features: [...shelled.features, { id: "g", type: "lip", name: "Groove", suppressed: false, targetBodyId: built.id, face: rim, shape: "groove", side: "outside", widthMillimeters: 0.4, heightMillimeters: 1, gapMillimeters: 0.1 } as never] };
  const removed = hollow - volume(groove);
  // Outer rim 30 × 20, band 0.5 wide (0.4 + 0.1 gap) with sharp corners (600 − 29 × 19 = 49 mm²), 1 deep: 49 mm³.
  expect(removed).toBeCloseTo(49, 3);
  const model = evaluatePartDocument(lip, { preview: true });
  expect(model.previewHandles?.some((h) => h.parameter === "height")).toBe(true);
}, 60000);

it("adds a snap-fit hook out of a face", () => {
  const box = createRectanglePartDocument("Block", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const snap = { ...box, features: [...box.features, { id: "snap", type: "snap-fit", name: "Snap", suppressed: false, targetBodyId: built.id, face: { sourceFeatureId: box.features[1].id, bodyId: built.id, label: "Top", normal: [0, 0, 1] }, pointMillimeters: [0, 0, 10], hookDirectionMillimeters: [1, 0, 0], lengthMillimeters: 8, thicknessMillimeters: 1, widthMillimeters: 4, catchDepthMillimeters: 1, catchLengthMillimeters: 2 } as never] };
  // Arm 1 × 8 plus a 1 × 2 right-triangle catch, 4 wide: 36 mm³.
  expect(volume(snap) - 6000).toBeCloseTo(36, 1);
  const bad = { ...snap, features: snap.features.map((f) => f.id === "snap" ? { ...f, hookDirectionMillimeters: [0, 0, 1] } : f) };
  expect(() => evaluatePartDocument(bad as never)).toThrow();
}, 60000);
