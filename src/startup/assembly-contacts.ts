/** Contact sets on the solved assembly (SolidCraft's contact.*): which sets are live,
 *  and whether their bodies pass through each other at given placements. Pure over
 *  the projection except for the engine call. */
import type { AssemblyProjectionV1 } from "../cad-assembly-bridge";
import type { AssemblySolution } from "../assembly-types";
import type { PartDocument } from "../aether-core";

export interface LiveContactSet { id: string; name: string; instance_ids: string[] }
/** The sets to check: the unsuppressed ones when contacts are on; with none defined,
 *  every unsuppressed occurrence is one set (contact.enable_all). Off: nothing. */
export function liveContactSets(projection: Pick<AssemblyProjectionV1, "contact_sets" | "contacts_enabled" | "instances">): LiveContactSet[] {
  if (!projection.contacts_enabled) return [];
  const active = new Set(projection.instances.filter((i) => !i.suppressed).map((i) => i.id));
  const defined = projection.contact_sets ?? [];
  const sets = defined.length ? defined.filter((set) => !set.suppressed).map((set) => ({
    id: set.id, name: set.name, instance_ids: set.instance_ids.filter((id) => active.has(id)),
  })) : [{ id: "all", name: "All occurrences", instance_ids: [...active] }];
  return sets.filter((set) => set.instance_ids.length >= 2);
}

export interface ContactOverlapReport { set: string; first: string; second: string; volume_mm3: number }
export async function checkAssemblyContacts(projection: AssemblyProjectionV1, placements: AssemblySolution["instances"], deps: { parseDocument(source: string): PartDocument; checkContacts(input: { parts: { id: string; document: PartDocument }[]; placements: { id: string; part: string; placement_mm: readonly [number, number, number]; rotation: readonly [number, number, number, number] }[]; sets: { id: string; instance_ids: string[] }[] }): Promise<{ overlaps: { set_id: string; first_instance_id: string; second_instance_id: string; volume_mm3: number }[]; checked_pairs: number }> }): Promise<ContactOverlapReport[]> {
  const sets = liveContactSets(projection);
  if (!sets.length) return [];
  const needed = new Set(sets.flatMap((set) => set.instance_ids));
  const instances = projection.instances.filter((i) => needed.has(i.id));
  const names = new Map(instances.map((i) => [i.id, i.name]));
  const definitions = new Map(projection.part_definitions.map((p) => [p.id, p]));
  const placementMap = new Map(placements.map((p) => [p.id, p]));
  for (const instance of instances) {
    if (instance.definition_kind !== "part" || !definitions.get(instance.definition_id)?.feature_document || !placementMap.has(instance.id)) {
      throw Error(`Cannot check contacts for ${instance.name}: exact Part geometry and a solved placement are required.`);
    }
  }
  const partIDs = new Set(instances.map((i) => i.definition_id));
  const parts = [...partIDs].map((id) => ({ id, document: deps.parseDocument(JSON.stringify(definitions.get(id)!.feature_document)) }));
  const byInstance = new Map(instances.map((i) => [i.id, i.definition_id]));
  const placed = placements.filter((p) => needed.has(p.id)).map((p) => ({ id: p.id, part: byInstance.get(p.id)!, placement_mm: p.placement_mm, rotation: p.rotation }));
  const result = await deps.checkContacts({ parts, placements: placed, sets: sets.map((s) => ({ id: s.id, instance_ids: s.instance_ids })) });
  const setNames = new Map(sets.map((s) => [s.id, s.name]));
  return result.overlaps.map((o) => ({ set: setNames.get(o.set_id) ?? o.set_id, first: names.get(o.first_instance_id) ?? o.first_instance_id, second: names.get(o.second_instance_id) ?? o.second_instance_id, volume_mm3: o.volume_mm3 }));
}
export const describeOverlaps = (overlaps: ContactOverlapReport[]) => overlaps.length
  ? `${overlaps.length} pair${overlaps.length === 1 ? "" : "s"} pass through each other: ${overlaps.slice(0, 4).map((o) => `${o.first} / ${o.second} (${o.volume_mm3.toFixed(1)} mm³)`).join(", ")}${overlaps.length > 4 ? ", …" : ""}.`
  : "No contact set passes through itself at this solve.";
