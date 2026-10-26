
import { expect, it } from "vitest";
import { availableBodies, createEmptyPartDocument, insertFeature, serializePartDocument } from "@aether/core/document";
import { resolveBodyOutputs } from "./body-outputs";
function fixture() {
  let doc = createEmptyPartDocument("Two parts");
  doc = insertFeature(doc, { id: "s", type: "profile", name: "Sketch", plane: "XY", offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [0, 20].map(x => ({ id: `c${x}`, type: "circle" as const, center: [x, 0] as [number,number], radius: 2 })) } });
  return insertFeature(doc, { id: "e", type: "extrude", name: "Extrude", suppressed: false, operation: "new", profileFeatureId: "s", profileContourIds: ["c0", "c20"], regionMode: "faces", separateBodies: true, bodyId: "two", distanceMillimeters: 6 });
}
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

it("accepts canonical whole-part pattern identities and refuses substituted or missing copies", () => {
  const doc = fixture();
  const extrusion = doc.features[1];
  if (extrusion.type === "extrude") delete extrusion.separateBodies;
  const patterned = insertFeature(doc, { id:"pattern", name:"Body pattern", type:"pattern", suppressed:false,
    sourceFeatureId:"e", patternType:"polar", axis:"Z", count:3, angleDegrees:360, reversed:false,
    bodyIds:["two"], copyBodyIds:{two:"copy"} });
  const before = serializePartDocument(patterned);
  const resolved = resolveBodyOutputs(patterned, {pattern:["copy:1","copy:2"]});
  expect(serializePartDocument(resolved)).toBe(before);
  expect(availableBodies(resolved).map(body=>body.id)).toEqual(["two","copy:1","copy:2"]);
  for (const ids of [[], ["copy:1"], ["copy:1","copy:1"], ["copy:1","foreign"]]) {
    expect(()=>resolveBodyOutputs(patterned,{pattern:ids})).toThrow(/saved copy identities/);
  }
  expect(serializePartDocument(patterned)).toBe(before);
});
