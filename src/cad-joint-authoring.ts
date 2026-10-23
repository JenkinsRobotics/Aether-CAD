/** As-built joints and rigid groups (SolidCraft's joint.as_built / joint.rigid_group):
 *  a joint between two occurrences that stay where they are. The joint frame is a
 *  world frame (default: the second occurrence's origin, world axes); each side gets a
 *  connector carrying that frame in its own part's coordinates, so the mate is
 *  satisfied by the current placement. Pure quaternion arithmetic, metres. */
import type { AssemblyMateTypeID } from "./cad-mate-authoring";

export type V3 = readonly [number, number, number];
export type Q = readonly [number, number, number, number];
export interface WorldFrame { origin_m: V3; primary_axis_xyz: V3; secondary_axis_xyz: V3 }
export interface Placement { position_m: V3; rotation_quaternion_xyzw: Q }

const conj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
/** Rotate v by unit quaternion q (xyzw). */
export function rotate(q: Q, v: V3): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
/** A world frame expressed in an occurrence's part coordinates. */
export function frameInPart(world: WorldFrame, placement: Placement): WorldFrame {
  const inverse = conj(placement.rotation_quaternion_xyzw);
  const d: V3 = [world.origin_m[0] - placement.position_m[0], world.origin_m[1] - placement.position_m[1], world.origin_m[2] - placement.position_m[2]];
  return { origin_m: rotate(inverse, d), primary_axis_xyz: rotate(inverse, world.primary_axis_xyz), secondary_axis_xyz: rotate(inverse, world.secondary_axis_xyz) };
}
/** The occurrence's own frame in the world: its origin and its rotated X/Z axes. */
export function frameOfPlacement(placement: Placement): WorldFrame {
  return { origin_m: placement.position_m, primary_axis_xyz: rotate(placement.rotation_quaternion_xyzw, [0, 0, 1]), secondary_axis_xyz: rotate(placement.rotation_quaternion_xyzw, [1, 0, 0]) };
}
export interface AsBuiltJointDraft {
  readonly name: string;
  readonly typeID: AssemblyMateTypeID;
  readonly aInstanceID: string;
  readonly bInstanceID: string;
  /** World joint origin in metres; default: b's origin. */
  readonly at?: V3;
  /** World primary axis; default: world Z. */
  readonly axis?: V3;
}
export const defaultAsBuiltJointDraft: AsBuiltJointDraft = Object.freeze({ name: "", typeID: "revolute" as AssemblyMateTypeID, aInstanceID: "", bInstanceID: "" });
export function asBuiltJointDraftIssues(draft: AsBuiltJointDraft): readonly string[] {
  const issues: string[] = [];
  if (!draft.aInstanceID || !draft.bInstanceID) issues.push("Choose two occurrences.");
  else if (draft.aInstanceID === draft.bInstanceID) issues.push("Choose two different occurrences.");
  if (draft.axis && Math.hypot(...draft.axis) < 1e-9) issues.push("The axis must not be zero.");
  return issues;
}
/** Connector frames for both sides so the joint holds at the current placement. */
export function asBuiltConnectorFrames(a: Placement, b: Placement, at?: V3, axis?: V3): { world: WorldFrame; a: WorldFrame; b: WorldFrame } {
  const bFrame = frameOfPlacement(b);
  const primary: V3 = axis && Math.hypot(...axis) > 1e-9 ? axis : bFrame.primary_axis_xyz;
  // A secondary not parallel to the primary; the workspace Gram-Schmidts it.
  const candidate: V3 = Math.abs(primary[0]) < 0.9 * Math.hypot(...primary) ? [1, 0, 0] : [0, 1, 0];
  const world: WorldFrame = { origin_m: at ?? bFrame.origin_m, primary_axis_xyz: primary, secondary_axis_xyz: candidate };
  return { world, a: frameInPart(world, a), b: frameInPart(world, b) };
}
