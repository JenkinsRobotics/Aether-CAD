import { expect, it } from "vitest";
import { isSectioned, lineParameterNearestRay, sectionClipPlane, type SectionView } from "./section-view-store";

const view = (patch: Partial<SectionView> = {}): SectionView => ({
  plane: { label: "Face", originMillimeters: [0, 0, 10], normal: [0, 0, 2] }, offsetMillimeters: -4, mode: "exclude", items: [], ...patch });

it("cuts away the side the face normal points to, moved by the offset", () => {
  const clip = sectionClipPlane(view())!;
  const kept = (p: [number, number, number]) => clip.normal.reduce((sum, n, i) => sum + n * p[i], 0) + clip.constant >= 0;
  expect(kept([0, 0, 5])).toBe(true);   // below the cut at z = 6
  expect(kept([0, 0, 7])).toBe(false);  // above it: removed
  expect(sectionClipPlane(view({ plane: null }))).toBeNull();
  expect(sectionClipPlane(view({ offsetMillimeters: NaN }))).toBeNull();
});

it("exclude cuts everything but the listed parts; include cuts only them", () => {
  const items = [{ id: "a", label: "Body 1" }];
  expect(isSectioned(view({ items }), "a")).toBe(false);
  expect(isSectioned(view({ items }), "b")).toBe(true);
  expect(isSectioned(view({ items, mode: "include" }), "a")).toBe(true);
  expect(isSectioned(view({ items, mode: "include" }), "b")).toBe(false);
});

it("drags along the normal: the line point nearest the pick ray", () => {
  // Line along +Z through the origin; a ray along +X at height 7 is nearest at t = 7.
  expect(lineParameterNearestRay([0, 0, 0], [0, 0, 1], [-50, 3, 7], [1, 0, 0])).toBeCloseTo(7);
  // Looking straight down the line gives no stable parameter.
  expect(lineParameterNearestRay([0, 0, 0], [0, 0, 1], [0, 0, 50], [0, 0, -1])).toBeNull();
});

it('reverses the kept half-space without moving an offset plane', () => {
  const view = { plane: { label: 'Top', originMillimeters: [0,0,10] as const, normal: [0,0,2] as const }, offsetMillimeters: 3, mode: 'exclude' as const, items: [] };
  expect(sectionClipPlane(view)).toEqual({ normal: [-0,-0,-1], constant: 13 });
  expect(sectionClipPlane({ ...view, reversed: true })).toEqual({ normal: [0,0,1], constant: -13 });
});
