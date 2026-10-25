import { expect, it } from "vitest";
import { createEmptyPartDocument, type ProfileFeature } from "./part-document";
import { parsePartDocument, serializePartDocument } from "./part-serialization";
import { resolveProfileDrawing } from "./profile-projection";
import { editProfileDimension } from "./profile-dimension";

function fixture() {
  const document = createEmptyPartDocument("Rail clearance");
  const source: ProfileFeature = {
    id: "source", name: "Rail", type: "profile", plane: "XY", offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [{ id: "rail", type: "path", start: [0, 50], segments: [{ type: "line", end: [100, 50] }] }] },
  };
  const target: ProfileFeature = {
    ...source, id: "target", name: "Clearance",
    profile: { type: "projection", sourceFeatureId: "source", authored: {
      type: "drawing", contours: [{ id: "point", type: "path", start: [50, 45], segments: [] }],
      constraints: [{ id: "gap", kind: "distance", value: 5,
        a: { kind: "point", contour: 0, index: 0 },
        b: { kind: "line", contour: -1, projectedContourId: "rail", index: 0 } }],
    } },
  };
  document.features = [source, target];
  return document;
}

it("captures legacy intent before upstream editing and retains it through save/reopen", () => {
  const legacy = { ...fixture(), formatVersion: 21 };
  const bytes = JSON.stringify(legacy);
  const migrated = parsePartDocument(bytes);
  expect(migrated.formatVersion).toBe(22);
  expect(migrated.features[1]).toMatchObject({ profile: { authored: { constraints: [{ distanceSide: 1 }] } } });
  for (const height of [20, 80, 6, 400, 50]) {
    const source = migrated.features[0] as ProfileFeature;
    if (source.profile.type !== "drawing" || source.profile.contours[0].type !== "path") throw Error();
    source.profile.contours[0].start[1] = height;
    source.profile.contours[0].segments[0].end[1] = height;
    const reopened = parsePartDocument(serializePartDocument(migrated));
    expect(resolveProfileDrawing(reopened.features, "target").contours.at(-1)).toMatchObject({ start: [expect.closeTo(50), expect.closeTo(height - 5)] });
  }
  expect(JSON.stringify(legacy)).toBe(bytes);
});

it("captures on save without modifying the caller and preserves missing sources for repair", () => {
  const input = fixture();
  const before = structuredClone(input);
  expect(JSON.parse(serializePartDocument(input)).features[1]).toMatchObject({ profile: { authored: { constraints: [{ distanceSide: 1 }] } } });
  expect(input).toEqual(before);
  input.features.shift();
  const broken = parsePartDocument(serializePartDocument(input));
  expect(broken.features).toEqual(input.features);
  expect(() => resolveProfileDrawing(broken.features, "target")).toThrow(/Broken projection/);
});

it("edits a projected dimension on the saved side without leaking derived context", () => {
  const input = parsePartDocument(serializePartDocument(fixture()));
  const source = input.features[0] as ProfileFeature;
  if (source.profile.type !== "drawing" || source.profile.contours[0].type !== "path") throw Error();
  source.profile.contours[0].start[1] = source.profile.contours[0].segments[0].end[1] = 20;
  const before = structuredClone(input);
  const edited = editProfileDimension(input, "target", "gap", 7);
  const target = edited.features[1] as ProfileFeature;
  if (target.profile.type !== "projection") throw Error();
  expect(target.profile.authored!.contours[0]).toMatchObject({ start: [expect.closeTo(50), expect.closeTo(13)] });
  expect(target.profile.authored!.constraints![0]).toMatchObject({ value: 7, distanceSide: 1 });
  expect(target.profile.authored!.projectionContext).toBeUndefined();
  expect(target.profile.authored!.pierceContext).toBeUndefined();
  expect(parsePartDocument(serializePartDocument(edited))).toEqual(edited);
  expect(input).toEqual(before);
  expect(() => editProfileDimension(input, "target", "missing", 7)).toThrow(/driving dimension/);
});

it("refuses malformed side metadata even when its source is missing", () => {
  const input = fixture();
  input.features.shift();
  const target = input.features[0] as ProfileFeature;
  if (target.profile.type !== "projection") throw Error();
  Object.assign(target.profile.authored!.constraints![0], { distanceSide: 0 });
  expect(() => parsePartDocument(JSON.stringify(input))).toThrow(/Distance side/);
});
