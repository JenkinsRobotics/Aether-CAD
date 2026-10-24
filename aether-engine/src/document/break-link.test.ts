import { expect, it } from "vitest";
import { createEmptyPartDocument } from "./part-document";
import { breakProjectionLink } from "./break-link";
import { resolveProfileDrawing } from "./profile-projection";

it("turns a projected sketch into its own drawing, keeping geometry and remapping relations", () => {
  const doc = createEmptyPartDocument("Linked");
  doc.features.push({ id: "src", type: "profile", name: "Source", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ type: "circle", id: "ring", center: [0, 0], radius: 5 }] } } as never);
  doc.features.push({ id: "p", type: "profile", name: "Projected", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "projection", sourceFeatureId: "src",
    authored: { type: "drawing", contours: [{ type: "circle", id: "own", center: [20, 0], radius: 2 }], constraints: [{ id: "eq", kind: "equal", a: { contour: -1, projectedContourId: "ring", kind: "circle" }, b: { contour: 0, kind: "circle" } }] } } } as never);
  const before = resolveProfileDrawing(doc.features, "p");
  const next = breakProjectionLink(doc, "p");
  const profile = (next.features[1] as { profile: { type: string; contours: { id?: string }[]; constraints: { a: { contour: number; projectedContourId?: string }; b: { contour: number } }[] } }).profile;
  expect(profile.type).toBe("drawing");
  expect(profile.contours.map((c) => c.id)).toEqual(["ring", "own"]);
  expect(profile.constraints[0].a).toEqual({ contour: 0, kind: "circle" });
  expect(profile.constraints[0].b).toEqual({ contour: 1, kind: "circle" });
  // The source can change without moving the unlinked copy.
  (next.features[0] as { profile: { contours: { radius: number }[] } }).profile.contours[0].radius = 9;
  expect(resolveProfileDrawing(next.features, "p").contours.map((c) => (c as { radius: number }).radius)).toEqual(before.contours.map((c) => (c as { radius: number }).radius));
  expect(() => breakProjectionLink(next, "p")).toThrow(/projected sketch/);
});
