import { expect, it } from "vitest";
import { createRectanglePartDocument, serializePartDocument, PART_DOCUMENT_VERSION } from "@aether/core/document";
import { prepareCommand, finalizeCandidate } from "./commands";

it("does not create an automation revision merely by reading/migrating a v3 Part", () => {
  const part = createRectanglePartDocument("Legacy", { widthMillimeters: 10, heightMillimeters: 20, depthMillimeters: 5 },
    { documentId: "old", sketchId: "sketch", extrudeId: "pad" });
  const source = JSON.stringify({ ...part, formatVersion: 3 });
  const original = source;
  expect(prepareCommand("cad.part.inspect", source, {}).changed).not.toBe(true);
  expect(prepareCommand("cad.extrude.setdepth", source, { feature_id: "pad", depth_mm: 5 }).changed).toBe(false);
  const changed = prepareCommand("cad.extrude.setdepth", source, { feature_id: "pad", depth_mm: 8 });
  expect(changed.changed).toBe(true);
  const saved = JSON.parse(finalizeCandidate(changed.candidate!, {}));
  expect(saved.formatVersion).toBe(PART_DOCUMENT_VERSION);
  expect(saved.features[1]).toMatchObject({ id: "pad", distanceMillimeters: 8 });
  expect(saved.documentId).toBe("old");
  expect(source).toBe(original);
  expect(prepareCommand("cad.extrude.setdepth", serializePartDocument(saved), { feature_id: "pad", depth_mm: 8 }).changed).toBe(false);
});

it("refuses future files at automation entry before translating or editing", () => {
  const source = JSON.stringify({ format: "aether-part", formatVersion: PART_DOCUMENT_VERSION + 1, features: null });
  for (const command of ["cad.part.inspect", "cad.part.evaluate", "cad.extrude.setdepth"]) {
    expect(() => prepareCommand(command, source, { feature_id: "pad", depth_mm: 8 })).toThrow(/Unsupported Part format version/);
  }
});
