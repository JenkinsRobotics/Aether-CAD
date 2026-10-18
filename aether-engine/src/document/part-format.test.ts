import { describe, expect, it } from "vitest";
import { createRectanglePartDocument, PART_DOCUMENT_VERSION, validatePartDocument } from "./part-document";
import { migratePartDocument, parsePartDocument, serializePartDocument } from "./part-serialization";
import { createWheelExample } from "./wheel-example";

const part = () => createRectanglePartDocument("Version boundary", {
  widthMillimeters: 20, heightMillimeters: 10, depthMillimeters: 5,
}, { documentId: "doc", sketchId: "sketch", extrudeId: "pad" });

describe("Part file version boundary", () => {
  it("writes v21 for new documents and examples", () => {
    expect(PART_DOCUMENT_VERSION).toBe(21);
    for (const doc of [part(), createWheelExample()]) {
      expect(JSON.parse(serializePartDocument(doc)).formatVersion).toBe(PART_DOCUMENT_VERSION);
      expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
    }
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])("migrates v%s without rewriting history, references or metadata", version => {
    const source = { ...part(), formatVersion: version, rollbackIndex: 1,
      document_settings: { description: "Retain this", units: { length: { unit: "in", decimals: 5 } } },
      sketchPresentation: { sketch: { dimensionLabelPositionsMillimeters: { width: [7, 11] } } },
      futurePresentationMetadata: { custom: [1, 2, 3] },
    };
    Object.assign(source.features[1], {
      bodyId: "solid", directionVector: [0, 0, 1], draftAngleDegrees: 5,
      operation: "cut", targetBodyId: "first", startingOffsetMillimeters: 2, targetBodyIds: ["first", "second"],
      secondEnd: { endType: "up-to-face", distanceMillimeters: 1, endOffsetMillimeters: -2,
        draftAngleDegrees: -3, endReference: { sourceFeatureId: "limit", bodyId: "stop",
          normal: [0, 0, -1], label: "Stop", faceAnchor: { centerMillimeters: [1, 2, 3], areaSquareMillimeters: 20 } } },
    });
    const before = JSON.stringify(source);
    for (const format of ["aether-part", "open-cad-part"]) {
      const migrated = parsePartDocument(JSON.stringify({ ...source, format }));
      expect(migrated).toEqual({ ...source, format: "aether-part", formatVersion: PART_DOCUMENT_VERSION });
      expect(parsePartDocument(serializePartDocument(migrated))).toEqual(migrated);
    }
    expect(JSON.stringify(source)).toBe(before);
  });
  it.each([undefined, null, true, "3", "4", 0, -1, 1.5, PART_DOCUMENT_VERSION+1, 999])("rejects unsupported version %s before interpreting fields", version => {
    const source = { ...part(), formatVersion: version, variables: "unknown future schema", features: null };
    expect(() => parsePartDocument(JSON.stringify(source))).toThrow(/Unsupported Part format version/);
    expect(() => migratePartDocument(source)).toThrow(/Unsupported Part format version/);
  });
  it("checks the header before evaluating variables or presentation", () => {
    const future = { format: "aether-part", formatVersion: PART_DOCUMENT_VERSION+1,
      get variables() { throw Error("Must not interpret future fields"); },
    };
    expect(() => validatePartDocument(future)).toThrow(/Update Aether CAD/);
  });
  it("requires explicit migration before serializing legacy records", () => {
    const old = { ...part(), formatVersion: 3 };
    expect(() => serializePartDocument(old)).toThrow(/Unsupported Part format version/);
    expect(JSON.parse(serializePartDocument(parsePartDocument(JSON.stringify(old)))).formatVersion).toBe(PART_DOCUMENT_VERSION);
  });
});
