import { expect, it } from "vitest";
import { parsePartDocument, resolveProfileDrawing, serializePartDocument } from "@aether/core/document";
import fixture from "../../service/tests/fixtures/projected-distance.json";
import { preparePartEdit } from "./live-commands";

it("uses source movement and authored projection dimension edits without changing references", () => {
  const original = parsePartDocument(JSON.stringify(fixture));
  const moved = preparePartEdit(original, "aether_cad_sketch_translate", {
    feature_id: "source", dx_mm: 0, dy_mm: -30,
  }).document;
  const edited = preparePartEdit(moved, "aether_cad_sketch_dimension", {
    feature_id: "target", dimension_id: "gap", value: 7,
  }).document;
  const reopened = parsePartDocument(serializePartDocument(edited));
  expect(resolveProfileDrawing(reopened.features, "target").contours.at(-1)).toMatchObject({
    center: [expect.closeTo(50), expect.closeTo(13)], radius: 2,
  });
  expect(reopened.features[1]).toMatchObject({ profile: {
    type: "projection", sourceFeatureId: "source", authored: { constraints: [
      { id: "gap", value: 7, distanceSide: 1, b: { projectedContourId: "rail" } },
      { id: "radius", value: 2 },
    ] },
  } });
  expect(original.features[0]).toEqual(fixture.features[0]);
  expect(() => preparePartEdit(moved, "aether_cad_sketch_dimension", {
    feature_id: "target", dimension_id: "gap", value: -2,
  })).toThrow();
});
