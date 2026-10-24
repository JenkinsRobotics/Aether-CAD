import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { createEmptyPartDocument } from "../document/part-document";
import { availableBodies, bodyIDForFeature, type PartFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);

/** Two overlapping 20 × 20 × 10 boxes, offset by 10 in x: three cells (A only, both, B only). */
function twoBoxes() {
  const doc = createEmptyPartDocument("Cells");
  const square = (id: string, x: number) => ({ id, type: "profile", name: id, plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[x, 0], [x + 20, 0], [x + 20, 20], [x, 20]] } });
  doc.features.push(square("sa", 0) as never, { id: "a", type: "extrude", name: "A", profileFeatureId: "sa", distanceMillimeters: 10, operation: "new", suppressed: false } as never);
  doc.features.push(square("sb", 10) as never, { id: "b", type: "extrude", name: "B", profileFeatureId: "sb", distanceMillimeters: 10, operation: "new", suppressed: false } as never);
  return { doc, a: bodyIDForFeature(doc, doc.features[1]), b: bodyIDForFeature(doc, doc.features[3]) };
}
const volumes = (doc: ReturnType<typeof createEmptyPartDocument>) => { const out: Record<string, number> = {}; evaluatePartDocument(doc, { withBodies: (b) => { for (const [id, s] of b) out[id] = measureVolume(s as Shape3D); } }); return out; };

it("fills the shared cell and the two outer cells as a new body", () => {
  const { doc, a, b } = twoBoxes();
  const fill = { id: "f", type: "boundary-fill", name: "Fill", suppressed: false, toolBodyIds: [a, b], cellPointsMillimeters: [[15, 10, 5]], operation: "new" } as PartFeature;
  doc.features.push(fill);
  const id = bodyIDForFeature(doc, fill);
  expect(volumes(doc)[id]).toBeCloseTo(10 * 20 * 10, 3);
  // Both outer cells, tools removed: only the fill remains.
  doc.features[doc.features.length - 1] = { ...fill, cellPointsMillimeters: [[5, 10, 5], [25, 10, 5]], removeTools: true } as PartFeature;
  const v = volumes(doc);
  expect(Object.keys(v)).toEqual([id]);
  expect(v[id]).toBeCloseTo(2 * 10 * 20 * 10, 3);
  expect(availableBodies(doc).map((x) => x.id)).toEqual([id]);
});

it("refuses a point outside every tool", () => {
  const { doc, a, b } = twoBoxes();
  doc.features.push({ id: "f", type: "boundary-fill", name: "Fill", suppressed: false, toolBodyIds: [a, b], cellPointsMillimeters: [[100, 0, 0]], operation: "new" } as PartFeature);
  expect(() => evaluatePartDocument(doc)).toThrow(/outside every tool/);
});
