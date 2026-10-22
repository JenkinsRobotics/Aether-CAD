/** Motion studies and exploded views on the in-process solver (SolidCraft's
 *  motion.study / motion.export and explode.*): a study drives chosen mate DOFs
 *  through key values over steps and solves each step; an exploded view pushes
 *  every placed instance away from the assembly's centre. Both are pure over a
 *  solver job, so they are testable without a host or a document open. */
import type { AssemblyJob, AssemblySolution } from "../assembly-types";

export interface MotionKey { joint: string; dof: string; kind: "rotation" | "translation"; axis: "x" | "y" | "z"; points: [number, number][] }
export interface MotionFrame { step: number; values: Record<string, number>; placements: AssemblySolution["instances"] }

/** The key's value at a step: linear between its points, held beyond its ends. */
export function keyValueAt(points: [number, number][], step: number): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return 0;
  if (step <= sorted[0][0]) return sorted[0][1];
  if (step >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];
  for (let i = 1; i < sorted.length; i++) {
    const [s0, v0] = sorted[i - 1], [s1, v1] = sorted[i];
    if (step <= s1) return s1 === s0 ? v1 : v0 + (v1 - v0) * (step - s0) / (s1 - s0);
  }
  return sorted[sorted.length - 1][1];
}

/** The job with the keyed DOFs driven to their values at a step. */
export function jobAtStep(job: AssemblyJob, keys: MotionKey[], step: number): { job: AssemblyJob; values: Record<string, number> } {
  const values: Record<string, number> = {};
  const joints = job.joints.map((joint) => {
    const mine = keys.filter((key) => key.joint === joint.id);
    if (!mine.length) return joint;
    const dofs = ((joint.parameters?.dofs as { name: string }[] | undefined) ?? []).filter((dof) => !mine.some((key) => key.dof === dof.name));
    for (const key of mine) { const value = keyValueAt(key.points, step); values[`${key.joint}:${key.dof}`] = value; dofs.push({ name: key.dof, kind: key.kind, axis: key.axis, value } as { name: string }); }
    return { ...joint, parameters: { ...joint.parameters, dofs } };
  });
  return { job: { ...job, joints }, values };
}

export async function motionFrames(job: AssemblyJob, keys: MotionKey[], steps: number, solve: (job: AssemblyJob) => Promise<AssemblySolution> | AssemblySolution): Promise<MotionFrame[]> {
  if (!(steps >= 1 && steps <= 10000)) throw new Error("A motion study runs 1 to 10000 steps.");
  if (!keys.length) throw new Error("A motion study needs at least one keyed degree of freedom.");
  const frames: MotionFrame[] = [];
  for (let step = 0; step <= steps; step++) {
    const { job: stepped, values } = jobAtStep(job, keys, step);
    const solution = await solve(stepped);
    if (solution.status !== "ok") throw new Error(`Step ${step}: ${solution.message || "the assembly did not solve"}`);
    frames.push({ step, values, placements: solution.instances });
  }
  return frames;
}

/** Positions per step as CSV: step, each driven value, then x/y/z and the quaternion of every instance. */
export function motionFramesCSV(frames: MotionFrame[]): string {
  if (!frames.length) return "";
  const valueKeys = Object.keys(frames[0].values), ids = frames[0].placements.map((p) => p.id);
  const header = ["step", ...valueKeys, ...ids.flatMap((id) => [`${id}.x_mm`, `${id}.y_mm`, `${id}.z_mm`, `${id}.qx`, `${id}.qy`, `${id}.qz`, `${id}.qw`])];
  const rows: (number | string)[][] = frames.map((frame) => [frame.step, ...valueKeys.map((k) => frame.values[k]), ...ids.flatMap((id): (number | string)[] => { const p = frame.placements.find((i) => i.id === id); return p ? [...p.placement_mm, ...p.rotation] : ["", "", "", "", "", "", ""]; })]);
  return [header, ...rows].map((row) => row.map((v) => (typeof v === "number" ? +v.toFixed(6) : v)).join(",")).join("\n") + "\n";
}

/** Every placement pushed away from the centre of all placements by scale × its offset (SolidCraft's automatic explode). */
export function explodedPlacements(instances: AssemblySolution["instances"], scale = 1): AssemblySolution["instances"] {
  if (!instances.length) return [];
  const centre = instances.reduce((c, i) => [c[0] + i.placement_mm[0] / instances.length, c[1] + i.placement_mm[1] / instances.length, c[2] + i.placement_mm[2] / instances.length], [0, 0, 0]);
  return instances.map((i) => ({ ...i, placement_mm: [i.placement_mm[0] + scale * (i.placement_mm[0] - centre[0]), i.placement_mm[1] + scale * (i.placement_mm[1] - centre[1]), i.placement_mm[2] + scale * (i.placement_mm[2] - centre[2])] as [number, number, number] }));
}
