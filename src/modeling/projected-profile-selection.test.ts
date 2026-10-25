import { expect, it } from "vitest";
import { parsePartDocument, resolveProfileDrawing, sketchRegions, type ProfileFeature } from "@aether/core/document";
import fixture from "../../service/tests/fixtures/projected-distance.json";
import { selectAgentProfileRegions } from "../automation/sketch-selection";
import { inspectSketch } from "../automation/sketch-edit";
import { stampResolvedProfileSelection, stampSketchContour } from "./profile-region-selection";

function setup() {
  const document = parsePartDocument(JSON.stringify(fixture));
  const feature = document.features[1] as ProfileFeature;
  if (feature.profile.type !== "projection" || !feature.profile.authored) throw Error();
  return { document, feature, profile: feature.profile, authored: feature.profile.authored };
}

it("stamps an authored loop without flattening its projection or changing source geometry", () => {
  const { document, feature, profile, authored } = setup();
  delete authored.contours[0].id;
  const source = structuredClone(document.features[0]);
  const selection = selectAgentProfileRegions(document, feature.id, [50, 45])[0];
  expect(selection.profileContourId).toBeTruthy();
  expect(profile.authored!.contours[0].id).toBe(selection.profileContourId);
  expect(profile.type).toBe("projection");
  expect(profile.sourceFeatureId).toBe("source");
  expect(document.features[0]).toEqual(source);
  expect(profile.authored!.constraints![0].b!.projectedContourId).toBe("rail");
  expect(stampSketchContour(document, feature.id, 1)).toBe(selection.profileContourId);
  expect(inspectSketch(document, { feature_id: feature.id }).regions.items[0].selectable).toBe(true);
});

it("stamps an overlap between authored loops with persistent region boundaries", () => {
  const { document, feature, authored } = setup();
  authored.contours.push({ type: "circle", center: [52, 45], radius: 2 });
  const regions = sketchRegions(feature, false, document.features);
  expect(regions.length).toBe(3);
  const selected = selectAgentProfileRegions(document, feature.id, [51, 45])[0];
  expect(selected.profileRegion!.contourIds).toHaveLength(2);
  expect(selected.profileRegion!.inside).toHaveLength(2);
  expect(feature.profile.type).toBe("projection");
  expect(resolveProfileDrawing(document.features, feature.id).contours).toHaveLength(3);
});

it("refuses projected boundaries without changing any authored identities", () => {
  const { document, feature } = setup();
  const before = structuredClone(document);
  expect(() => stampResolvedProfileSelection(document, feature, {
    engineId: "target#0", label: "Reference", contourIndex: 0,
  })).toThrow(/authored geometry/);
  expect(document).toEqual(before);
});

it("refuses a mixed authored/projected overlap atomically", () => {
  const { document, feature } = setup();
  const source = document.features[0] as ProfileFeature;
  if (source.profile.type !== "drawing") throw Error();
  source.profile.contours.push({ id: "reference-circle", type: "circle", center: [52, 45], radius: 2 });
  const before = structuredClone(document);
  expect(() => selectAgentProfileRegions(document, feature.id, [51, 45])).toThrow(/authored geometry/);
  expect(document).toEqual(before);
});
