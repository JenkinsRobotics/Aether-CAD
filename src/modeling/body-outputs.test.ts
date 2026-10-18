import { featureReferenceErrors } from "@aether/core/document";
import { expect, it } from "vitest";
import { availableBodies, createEmptyPartDocument, insertFeature, parsePartDocument, serializePartDocument, dependentFeatures, setFeatureSuppressed } from "@aether/core/document";
import { resolveBodyOutputs } from "./body-outputs";
import { translateDocument } from "../freecad-translate";
function fixture() {
  let doc = createEmptyPartDocument("Two parts");
  doc = insertFeature(doc, { id: "s", type: "profile", name: "Sketch", plane: "XY", offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [0, 20].map(x => ({ id: `c${x}`, type: "circle" as const, center: [x, 0] as [number,number], radius: 2 })) } });
  return insertFeature(doc, { id: "e", type: "extrude", name: "Extrude", suppressed: false, operation: "new", profileFeatureId: "s", profileContourIds: ["c0", "c20"], regionMode: "faces", separateBodies: true, bodyId: "two", distanceMillimeters: 6 });
}
it("persists separate outputs and routes downstream edits through their producer", () => {
  const draft = fixture();
  const doc = resolveBodyOutputs(draft, { e: ["two:solid-a", "two:solid-b"] });
  expect(availableBodies(draft).map(b => b.id)).toEqual(["two"]);
  const opened = parsePartDocument(serializePartDocument(doc));
  expect(availableBodies(opened).map(b => b.id)).toEqual(["two:solid-a", "two:solid-b"]);
  const cut = insertFeature(opened, { id: "cut", type: "extrude", name: "Cut", suppressed: false, operation: "cut", profileFeatureId: "s", profileContourId: "c20", targetBodyId: "two:solid-b", distanceMillimeters: 3 });
  expect(dependentFeatures(cut, "e").has("cut")).toBe(true);
  expect(availableBodies(setFeatureSuppressed(cut, "e", true))).toHaveLength(0);
  const translated = translateDocument(cut);
  expect(translated.features.find(f => f.id === "e")?.parameters).toMatchObject({ body_id: "two", separate_bodies: true, profile_keys: { "s#0": "c0", "s#1": "c20" } });
  expect(translated.features.at(-1)?.parameters.body_id).toBe("two:solid-b");
  expect(featureReferenceErrors(resolveBodyOutputs(cut, { e: ["two:solid-changed"] })).has("cut")).toBe(true);
});
it("rejects missing, duplicated or foreign native identities without changing the document", () => {
  const doc = fixture(); const before = serializePartDocument(doc);
  for (const outputs of ([{}, { e: ["two:solid-a", "two:solid-a"] }, { e: ["foreign"] }, { e: ["two:solid-a"], unknown: ["other"] }] as Record<string, string[]>[])) {
    expect(() => resolveBodyOutputs(doc, outputs)).toThrow();
  }
  expect(serializePartDocument(doc)).toBe(before);
});
it("retains legacy grouped-body behavior", () => {
  const doc = fixture(); const feature = doc.features[1];
  if (feature.type === "extrude") delete feature.separateBodies;
  expect(availableBodies(resolveBodyOutputs(doc)).map(b => b.id)).toEqual(["two"]);
});
