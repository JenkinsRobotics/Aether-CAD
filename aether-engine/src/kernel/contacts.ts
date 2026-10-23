/** Contact checks for assemblies (SolidCraft's contact.check): the bodies of placed
 *  instances within one contact set must not pass through each other. Each part's
 *  bodies are evaluated once, placed at the instance's placement (millimetres and a
 *  quaternion), and every pair inside a set is intersected; a pair overlaps when the
 *  common volume is above a hair. */
import { isShape3D, measureVolume, type Shape3D } from "replicad";
import { evaluatePartDocument, release } from "./part-evaluator";
import type { PartDocument } from "../document/index";

export interface ContactPlacement { id: string; part: string; placement_mm: readonly [number, number, number]; rotation: readonly [number, number, number, number] }
export interface ContactCheckInput { parts: { id: string; document: PartDocument }[]; placements: ContactPlacement[]; sets: { id: string; instance_ids: string[] }[] }
export interface ContactOverlap { set_id: string; first_instance_id: string; second_instance_id: string; volume_mm3: number }

/** A quaternion as a rotation about an axis, for replicad's rotate (degrees). */
function axisAngle(q: readonly [number, number, number, number]): { axis: [number, number, number]; degrees: number } {
  const [x, y, z, w] = q, s = Math.hypot(x, y, z);
  if (s < 1e-12) return { axis: [0, 0, 1], degrees: 0 };
  return { axis: [x / s, y / s, z / s], degrees: 2 * Math.atan2(s, w) * 180 / Math.PI };
}

export function checkContacts(input: ContactCheckInput): { overlaps: ContactOverlap[]; checked_pairs: number } {
  const partBodies = new Map<string, Shape3D[]>();
  for (const part of input.parts) {
    const bodies: Shape3D[] = [];
    evaluatePartDocument(part.document, { withBodies: (map) => { for (const body of map.values()) bodies.push(body.clone()); } });
    partBodies.set(part.id, bodies);
  }
  const placed = new Map<string, Shape3D[]>();
  for (const placement of input.placements) {
    const { axis, degrees } = axisAngle(placement.rotation);
    placed.set(placement.id, (partBodies.get(placement.part) ?? []).map((body) => {
      let shape: Shape3D = body.clone();
      if (Math.abs(degrees) > 1e-9) shape = shape.rotate(degrees, [0, 0, 0], axis) as Shape3D;
      return shape.translate(placement.placement_mm[0], placement.placement_mm[1], placement.placement_mm[2]) as Shape3D;
    }));
  }
  const overlaps: ContactOverlap[] = [];
  let pairs = 0;
  for (const set of input.sets) {
    const ids = set.instance_ids.filter((id) => placed.has(id));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      pairs++;
      let volume = 0;
      for (const a of placed.get(ids[i])!) for (const b of placed.get(ids[j])!) {
        const common = a.intersect(b);
        try { if (isShape3D(common)) volume += measureVolume(common); } catch { /* no common solid */ }
        release(common);
      }
      if (volume > 1e-6) overlaps.push({ set_id: set.id, first_instance_id: ids[i], second_instance_id: ids[j], volume_mm3: volume });
    }
  }
  for (const bodies of placed.values()) bodies.forEach(release);
  for (const bodies of partBodies.values()) bodies.forEach(release);
  return { overlaps, checked_pairs: pairs };
}
