import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureArea, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { bodyIDForFeature, createEmptyPartDocument, type PartFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

it("trims a sheet at a plane, keeping the side the keep point is on", () => {
  const doc = createEmptyPartDocument("Trim");
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "L", type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }, { type: "line", end: [10, 5] }] }] } } as PartFeature);
  doc.features.push({ id: "e", type: "surface-extrude", name: "Sheet", suppressed: false, operation: "new", profileFeatureId: "s", distanceMillimeters: 4 } as PartFeature);
  const id = bodyIDForFeature(doc, doc.features[1]);
  const area = (d: typeof doc) => { let a = 0; evaluatePartDocument(d, { withBodies: (b) => { a = measureArea(b.get(id) as Shape3D); } }); return a; };
  expect(area(doc)).toBeCloseTo(60, 6);
  const trim = (offset: number, keep: [number, number, number]) => ({ ...doc, features: [...doc.features, { id: "t", type: "surface-trim", name: "Trim", suppressed: false, bodyIds: [id], plane: { kind: "principal", plane: "YZ", offsetMillimeters: offset }, keepPointMillimeters: keep } as PartFeature] });
  // x > 5: half of the long face (5 × 4) and all of the short one (5 × 4).
  expect(area(trim(5, [8, 0, 2]))).toBeCloseTo(40, 6);
  // x < 5: the other half of the long face.
  expect(area(trim(5, [2, 0, 2]))).toBeCloseTo(20, 6);
  expect(() => evaluatePartDocument(trim(50, [2, 0, 2]))).toThrow(/does not cross/);
});
