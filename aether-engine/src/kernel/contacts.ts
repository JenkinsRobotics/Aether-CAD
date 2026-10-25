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
  const partBodies = new Map<string, Shape3D[]>(), placed = new Map<string, Shape3D[]>();
  try {
    for (const part of input.parts) {
      if (partBodies.has(part.id)) throw Error("Duplicate contact Part identity.");
      const bodies: Shape3D[] = [];
      partBodies.set(part.id, bodies);
      evaluatePartDocument(part.document, { withBodies: (map) => { for (const body of map.values()) bodies.push(body.clone()); } });
      if (!bodies.length) throw Error(`Contact Part ${part.id} has no exact solid geometry.`);
    }
    for (const placement of input.placements) {
      if (placed.has(placement.id) || !partBodies.has(placement.part)) throw Error("Contact placement has a duplicate ID or missing Part.");
      if (placement.placement_mm.length !== 3 || placement.rotation.length !== 4
        || [...placement.placement_mm, ...placement.rotation].some((v) => !Number.isFinite(v))
        || Math.abs(Math.hypot(...placement.rotation) - 1) > 1e-6) throw Error("Invalid contact placement.");
      const { axis, degrees } = axisAngle(placement.rotation);
      const shapes: Shape3D[] = [];
      placed.set(placement.id, shapes);
      for (const body of partBodies.get(placement.part)!) {
        let shape: Shape3D = body.clone();
        try {
          // Replicad transforms consume their input; only retain the final shape.
          if (Math.abs(degrees) > 1e-9) shape = shape.rotate(degrees, [0, 0, 0], axis) as Shape3D;
          shape = shape.translate(...placement.placement_mm) as Shape3D;
          shapes.push(shape);
        } catch (error) { release(shape); throw error; }
      }
    }
    const overlaps: ContactOverlap[] = [];
    let pairs = 0;
    for (const set of input.sets) {
      const ids = set.instance_ids;
      if (new Set(ids).size !== ids.length || ids.some((id) => !placed.has(id))) throw Error("Contact set has duplicate or missing occurrences.");
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        pairs++;
        let volume = 0;
        for (const a of placed.get(ids[i])!) for (const b of placed.get(ids[j])!) {
          const common = a.intersect(b);
          try { if (isShape3D(common)) volume += measureVolume(common); }
          finally { release(common); }
        }
        if (!Number.isFinite(volume)) throw Error("Contact intersection returned an invalid volume.");
        if (volume > 1e-6) overlaps.push({ set_id: set.id, first_instance_id: ids[i], second_instance_id: ids[j], volume_mm3: volume });
      }
    }
    return { overlaps, checked_pairs: pairs };
  } finally {
    for (const bodies of placed.values()) bodies.forEach(release);
    for (const bodies of partBodies.values()) bodies.forEach(release);
  }
}
