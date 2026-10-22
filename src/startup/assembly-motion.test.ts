import { expect, it } from "vitest";
import { solveAssemblyJob } from "@aether/core/kernel";
import { explodedPlacements, jobAtStep, keyValueAt, motionFrames, motionFramesCSV } from "./assembly-motion";
import type { AssemblyJob } from "../assembly-types";

const job: AssemblyJob = { parts: [{ id: "p" }], instances: [{ id: "g", part: "p", grounded: true }, { id: "a", part: "p", placement_mm: [10, 0, 0] }], joints: [{ id: "hinge", kind: "revolute", a: { instance: "g" }, b: { instance: "a" } }] };

it("interpolates keys, drives the keyed DOF per step and solves every frame", async () => {
  expect(keyValueAt([[0, 0], [10, 90]], 5)).toBe(45);
  expect(keyValueAt([[0, 0], [10, 90]], 20)).toBe(90);
  const key = { joint: "hinge", dof: "rotation", kind: "rotation" as const, axis: "z" as const, points: [[0, 0], [4, 90]] as [number, number][] };
  expect((jobAtStep(job, [key], 2).job.joints[0].parameters as { dofs: { value: number }[] }).dofs[0].value).toBe(45);
  const frames = await motionFrames(job, [key], 4, (j) => solveAssemblyJob(j));
  expect(frames).toHaveLength(5);
  expect(frames.map((f) => f.values["hinge:rotation"])).toEqual([0, 22.5, 45, 67.5, 90]);
  const last = frames[4].placements.find((p) => p.id === "a")!;
  const [x, y, z, w] = last.rotation; // a quarter turn about z
  expect(Math.abs(2 * Math.atan2(z, w) * 180 / Math.PI)).toBeCloseTo(90, 3); expect(Math.hypot(x, y)).toBeLessThan(1e-6);
  const csv = motionFramesCSV(frames);
  expect(csv.split("\n")[0]).toBe("step,hinge:rotation,g.x_mm,g.y_mm,g.z_mm,g.qx,g.qy,g.qz,g.qw,a.x_mm,a.y_mm,a.z_mm,a.qx,a.qy,a.qz,a.qw");
  expect(csv.split("\n")).toHaveLength(7); // header, five frames, trailing newline
});

it("explodes placements away from their centre by the scale", () => {
  const out = explodedPlacements([{ id: "a", placement_mm: [0, 0, 0], rotation: [0, 0, 0, 1] }, { id: "b", placement_mm: [10, 0, 0], rotation: [0, 0, 0, 1] }], 1);
  expect(out.map((p) => p.placement_mm[0])).toEqual([-5, 15]);
  expect(explodedPlacements([], 2)).toEqual([]);
});
