import { expect, it } from "vitest";
import { copyFeatures } from "./timeline-clipboard";
import { createEmptyPartDocument, validatePartDocument, type PartFeature } from "./index";

it("pastes copies at the marker with references following the copied set", () => {
  const doc = createEmptyPartDocument("Clip");
  doc.features.push({ id: "s", type: "profile", name: "Sketch 1", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [10, 0], [10, 10], [0, 10]] } } as PartFeature,
    { id: "e", type: "extrude", name: "Extrude 1", profileFeatureId: "s", distanceMillimeters: 5, operation: "new", suppressed: false } as PartFeature,
    { id: "f", type: "fillet", name: "Fillet 1", radiusMillimeters: 1, suppressed: false, targetBodyId: `${doc.documentId}:body-1` } as PartFeature);
  let n = 0;
  const { document: next, pasted } = copyFeatures(doc, ["s", "e"], () => `c${++n}`);
  expect(pasted).toEqual(["c1", "c2"]);
  const copiedExtrude = next.features.find((f) => f.id === "c2") as PartFeature & { profileFeatureId: string };
  expect(copiedExtrude.profileFeatureId).toBe("c1"); // follows the copied sketch
  expect(copiedExtrude.name).toBe("Extrude 1 copy");
  expect(next.features.map((f) => f.id)).toEqual(["s", "e", "f", "c1", "c2"]);
  validatePartDocument(next);
  // A copy that references a feature outside the set keeps that reference.
  const { document: only } = copyFeatures(doc, ["e"], () => "x1");
  expect((only.features.at(-1) as PartFeature & { profileFeatureId: string }).profileFeatureId).toBe("s");
  expect(() => copyFeatures(doc, ["nope"])).toThrow(/Choose the features/);
});
