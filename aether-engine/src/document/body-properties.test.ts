import { expect, it } from "vitest";
import { createRectanglePartDocument } from "./part-document";
import { parsePartDocument, serializePartDocument } from "./part-serialization";
it("roundtrips native body materials and rejects invalid saved finishes", () => {
  const doc = createRectanglePartDocument("Colored bracket", {
    widthMillimeters: 40,
    heightMillimeters: 30,
    depthMillimeters: 5,
  });
  doc.bodyProperties = {
    body: {
      name: "Bracket",
      visible: true,
      material: { name: "Aluminum", densityKgPerM3: 2700 },
      appearance: { color: "#aabbcc", metalness: 0.8, roughness: 0.3 },
    },
  };
  expect(parsePartDocument(serializePartDocument(doc)).bodyProperties).toEqual(
    doc.bodyProperties,
  );
  for (const invalid of [
    { opacity: NaN },
    { roughness: 2 },
    { color: "red" },
    { metalness: -1 },
  ]) {
    doc.bodyProperties.body.appearance = invalid;
    expect(() => serializePartDocument(doc)).toThrow();
  }
  doc.bodyProperties.body.appearance = {};
  doc.bodyProperties.body.material!.densityKgPerM3 = -1;
  expect(() => serializePartDocument(doc)).toThrow();
});
