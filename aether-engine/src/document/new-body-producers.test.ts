import { expect, it } from "vitest";
import { createEmptyPartDocument, featureReferenceErrors, bodyIDForFeature, type PartFeature } from "./index";
it("new-body surface and sheet features are body producers, not modifiers", () => {
  const doc = createEmptyPartDocument("R");
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [10, 0], [10, 10], [0, 10]] } } as PartFeature);
  const base: PartFeature = { id: "b", type: "sheet-base", name: "Base", suppressed: false, operation: "new", profileFeatureId: "s", thicknessMillimeters: 2, bendRadiusMillimeters: 2, kFactor: 0.44 } as PartFeature;
  const sheet: PartFeature = { id: "e", type: "surface-extrude", name: "Sheet", suppressed: false, operation: "new", profileFeatureId: "s", distanceMillimeters: 4 } as PartFeature;
  doc.features.push(base, sheet);
  doc.features.push({ id: "f", type: "sheet-flange", name: "F", suppressed: false, bodyIds: [bodyIDForFeature(doc, base)], edges: [{ kind: "curved-edge", sourceFeatureId: "b", bodyId: bodyIDForFeature(doc, base), label: "e", midpointMillimeters: [10, 5, 2], lengthMillimeters: 10 }], distanceMillimeters: 5, angleDegrees: 90 } as PartFeature);
  expect([...featureReferenceErrors(doc).values()]).toEqual([]);
});
