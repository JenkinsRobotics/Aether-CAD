import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { createRectanglePartDocument } from "../document/part-document";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);

it("splits the top face of a block along a plane, keeping the solid and its volume", () => {
  const box = createRectanglePartDocument("Block", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const top = { sourceFeatureId: box.features[1].id, bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] };
  const split = { ...box, features: [...box.features, { id: "sf", type: "split-face", name: "Split face", suppressed: false, targetBodyId: built.id, faces: [top], plane: { kind: "principal", plane: "YZ", offsetMillimeters: 5 } } as never] };
  const model = evaluatePartDocument(split);
  expect(model.parts).toHaveLength(1);
  expect(model.parts[0].topology).toHaveLength(7);
  let volume = 0; evaluatePartDocument(split, { withBodies: (b) => { volume = measureVolume([...b.values()][0] as Shape3D); } });
  expect(volume).toBeCloseTo(6000, 4);
  // A plane that misses the face is refused.
  const miss = { ...split, features: split.features.map((f) => f.id === "sf" ? { ...f, plane: { kind: "principal", plane: "YZ", offsetMillimeters: 100 } } : f) };
  expect(() => evaluatePartDocument(miss as never)).toThrow(/does not cross/);
});
