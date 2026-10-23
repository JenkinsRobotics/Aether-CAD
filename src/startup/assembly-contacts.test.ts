import { expect, it } from "vitest";
import { describeOverlaps, liveContactSets } from "./assembly-contacts";

it("lives only when contacts are on, and treats no sets as one set of everything", () => {
  const instances = [{ id: "a", suppressed: false }, { id: "b", suppressed: false }, { id: "c", suppressed: true }] as never;
  expect(liveContactSets({ contacts_enabled: false, contact_sets: [{ id: "s", name: "S", instance_ids: ["a", "b"], suppressed: false }], instances })).toEqual([]);
  expect(liveContactSets({ contacts_enabled: true, contact_sets: [], instances })).toEqual([{ id: "all", name: "All occurrences", instance_ids: ["a", "b"] }]);
  expect(liveContactSets({ contacts_enabled: true, contact_sets: [{ id: "s", name: "S", instance_ids: ["a", "b"], suppressed: false }, { id: "t", name: "T", instance_ids: ["a", "c"], suppressed: true }], instances })).toEqual([{ id: "s", name: "S", instance_ids: ["a", "b"] }]);
  expect(describeOverlaps([])).toMatch(/No contact set/);
  expect(describeOverlaps([{ set: "S", first: "Arm", second: "Base", volume_mm3: 12.3456 }])).toContain("Arm / Base (12.3 mm³)");
});
