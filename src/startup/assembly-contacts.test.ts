import { expect, it, vi } from "vitest";
import { checkAssemblyContacts, describeOverlaps, liveContactSets } from "./assembly-contacts";

it("lives only when contacts are on, and treats no sets as one set of everything", () => {
  const instances = [{ id: "a", suppressed: false }, { id: "b", suppressed: false }, { id: "c", suppressed: true }] as never;
  expect(liveContactSets({ contacts_enabled: false, contact_sets: [{ id: "s", name: "S", instance_ids: ["a", "b"], suppressed: false }], instances })).toEqual([]);
  expect(liveContactSets({ contacts_enabled: true, contact_sets: [], instances })).toEqual([{ id: "all", name: "All occurrences", instance_ids: ["a", "b"] }]);
  expect(liveContactSets({ contacts_enabled: true, contact_sets: [{ id: "s", name: "S", instance_ids: ["a", "b"], suppressed: false }, { id: "t", name: "T", instance_ids: ["a", "c"], suppressed: true }], instances })).toEqual([{ id: "s", name: "S", instance_ids: ["a", "b"] }]);
  expect(describeOverlaps([])).toMatch(/No contact set/);
  expect(describeOverlaps([{ set: "S", first: "Arm", second: "Base", volume_mm3: 12.3456 }])).toContain("Arm / Base (12.3 mm³)");
});

it("does not turn suppressed contact sets into enable-all or check suppressed occurrences", () => {
  const projection = { contacts_enabled: true, instances: [{ id: "a", suppressed: false }, { id: "b", suppressed: true }],
    contact_sets: [{ id: "s", name: "S", instance_ids: ["a", "b"], suppressed: true }] } as never;
  expect(liveContactSets(projection)).toEqual([]);
  expect(liveContactSets({ ...projection as any, contact_sets: [{ id: "s", name: "S", instance_ids: ["a", "b"], suppressed: false }] })).toEqual([]);
});
it("does not claim a successful contact check when an occurrence has no exact geometry", async () => {
  const checkContacts = vi.fn();
  const projection = { contacts_enabled: true, contact_sets: [],
    instances: [{ id: "a", name: "Imported mesh", suppressed: false, definition_kind: "part", definition_id: "p" },
      { id: "b", name: "B", suppressed: false, definition_kind: "part", definition_id: "p" }],
    part_definitions: [{ id: "p" }] } as never;
  await expect(checkAssemblyContacts(projection, [], { checkContacts, parseDocument: vi.fn() })).rejects.toThrow(/exact Part geometry/);
  expect(checkContacts).not.toHaveBeenCalled();
});
