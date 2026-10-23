import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { bodyIDForFeature, createEmptyPartDocument, type PartDocument, type PartFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const plate = (): PartDocument => {
  const doc = createEmptyPartDocument("Handles");
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [60, 0], [60, 40], [0, 40]] } } as PartFeature,
    { id: "e", type: "extrude", name: "E", profileFeatureId: "s", distanceMillimeters: 10, operation: "new", suppressed: false } as PartFeature);
  return doc;
};
const r = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000 + 0);

it("publishes the extrude axes at the profile's centre, even from the cache", () => {
  const doc = plate();
  const first = evaluatePartDocument(doc, { preview: true });
  expect(first.featurePreview?.extrusionAxes?.[0]).toMatchObject({ side: "primary", parameter: "distance", scale: 1, reversed: false });
  expect(r(first.featurePreview!.extrusionAxes![0].originMillimeters)).toEqual([30, 20, 0]);
  expect(r(first.featurePreview!.extrusionAxes![0].direction)).toEqual([0, 0, 1]);
  // Nothing changed: the cached step is replayed for the previewed feature, so the axes are still there.
  const again = evaluatePartDocument(doc, { preview: true });
  expect(again.featurePreview?.extrusionAxes).toHaveLength(1);
});

it("publishes a radius handle on a fillet's first edge pointing into the part, and an angle ring for a revolve", () => {
  const doc = plate();
  doc.features.push({ id: "f", type: "fillet", name: "F", radiusMillimeters: 2, suppressed: false, edges: [{ kind: "curved-edge", sourceFeatureId: "e", bodyId: bodyIDForFeature(doc, doc.features[1]), label: "top edge", midpointMillimeters: [30, 0, 10], lengthMillimeters: 60 }] } as PartFeature);
  const result = evaluatePartDocument(doc, { preview: true });
  const radius = result.previewHandles?.find((h) => h.parameter === "radius");
  expect(result.previewFeatureId).toBe("f");
  expect(radius?.kind).toBe("linear");
  expect(r(radius!.originMillimeters)).toEqual([30, 0, 10]);
  // Into the part: between the top face (−z inward) and the front face (+y inward).
  expect(radius!.direction[1]).toBeGreaterThan(0.5); expect(radius!.direction[2]).toBeLessThan(-0.5);
  const rev = createEmptyPartDocument("Rev");
  rev.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[10, 0], [20, 0], [20, 10], [10, 10]] } } as PartFeature,
    { id: "r", type: "revolve", name: "R", profileFeatureId: "s", axis: "Y", angleDegrees: 90, operation: "new", suppressed: false } as PartFeature);
  const angle = evaluatePartDocument(rev, { preview: true }).previewHandles?.find((h) => h.parameter === "angle");
  expect(angle?.kind).toBe("angular");
  expect(r(angle!.direction)).toEqual([0, 1, 0]);
  expect(r(angle!.originMillimeters)).toEqual([0, 5, 0]); // on the axis, level with the profile's centre
});

it("publishes depth and diameter handles for a hole, and length and angle handles for a flange", () => {
  const doc = plate();
  const bodyId = bodyIDForFeature(doc, doc.features[1]);
  doc.features.push({ id: "h", type: "hole", name: "H", suppressed: false, diameterMillimeters: 6, depthMillimeters: 5, cutType: "plain", depthType: "blind", placement: { kind: "face-point", face: { sourceFeatureId: "e", bodyId, label: "top", normal: [0, 0, 1] }, pointMillimeters: [30, 20, 10] }, targetBodyId: bodyId } as PartFeature);
  const hole = evaluatePartDocument(doc, { preview: true });
  const names = hole.previewHandles?.map((h) => h.parameter).sort();
  expect(names).toEqual(["depth", "diameter"]);
  const diameter = hole.previewHandles!.find((h) => h.parameter === "diameter")!;
  expect(diameter.scale).toBe(2);
  const sheet = createEmptyPartDocument("Sheet");
  sheet.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [100, 0], [100, 50], [0, 50]] } } as PartFeature);
  const base: PartFeature = { id: "b", type: "sheet-base", name: "Base", suppressed: false, operation: "new", profileFeatureId: "s", thicknessMillimeters: 2, bendRadiusMillimeters: 2, kFactor: 0.44 } as PartFeature;
  sheet.features.push(base);
  const id = bodyIDForFeature(sheet, base);
  sheet.features.push({ id: "fl", type: "sheet-flange", name: "Flange", suppressed: false, bodyIds: [id], edges: [{ kind: "curved-edge", sourceFeatureId: "b", bodyId: id, label: "x=100 top", midpointMillimeters: [100, 25, 2], lengthMillimeters: 50 }], distanceMillimeters: 20, angleDegrees: 90 } as PartFeature);
  const flange = evaluatePartDocument(sheet, { preview: true }).previewHandles!;
  expect(flange.map((h) => `${h.parameter}:${h.kind}`).sort()).toEqual(["angle:angular", "distance:linear"]);
  expect(r(flange.find((h) => h.parameter === "distance")!.direction)).toEqual([1, 0, 0]);
});
