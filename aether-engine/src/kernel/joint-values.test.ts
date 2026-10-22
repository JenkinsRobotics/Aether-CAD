import { expect, it } from "vitest";
import { solveAssemblyJob } from "./assembly-solver";

const base = { parts: [{ id: "p" }], instances: [{ id: "g", part: "p", grounded: true }, { id: "a", part: "p", placement_mm: [10, 0, 0] as [number, number, number] }, { id: "b", part: "p", placement_mm: [20, 0, 0] as [number, number, number] }] };
const xAxisOf = (q: readonly number[]) => { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)]; };

it("holds a revolute at its driven angle (joint.drive)", () => {
  const solved = solveAssemblyJob({ ...base, joints: [{ id: "hinge", kind: "revolute", a: { instance: "g" }, b: { instance: "a" }, parameters: { dofs: [{ name: "rotation", kind: "rotation", axis: "z", value: 90 }] } }] });
  expect(solved.status).toBe("ok");
  const a = solved.instances.find((i) => i.id === "a")!;
  expect(xAxisOf(a.rotation)[1]).toBeCloseTo(1, 4); // a's x now points along +y
  expect(a.placement_mm.map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0, 0, 0]);
});

it("couples two revolutes as gears and a revolute to a slider as a screw", () => {
  const gears = solveAssemblyJob({ ...base, joints: [
    { id: "j1", kind: "revolute", a: { instance: "g" }, b: { instance: "a" }, parameters: { dofs: [{ name: "rotation", kind: "rotation", axis: "z", value: 30 }] } },
    { id: "j2", kind: "revolute", a: { instance: "g", placement_mm: [50, 0, 0] }, b: { instance: "b" } },
  ], relations: [{ id: "gear", kind: "gear", driver: { joint: "j1", dof: "rotation" }, driven: { joint: "j2", dof: "rotation" }, ratio: 2, reversed: true }] });
  expect(gears.status).toBe("ok");
  const b = gears.instances.find((i) => i.id === "b")!;
  const angle = Math.atan2(xAxisOf(b.rotation)[1], xAxisOf(b.rotation)[0]) * 180 / Math.PI;
  expect(angle).toBeCloseTo(-60, 3); // reversed, twice the driver's 30°
  const screw = solveAssemblyJob({ ...base, joints: [
    { id: "turn", kind: "revolute", a: { instance: "g" }, b: { instance: "a" }, parameters: { dofs: [{ name: "rotation", kind: "rotation", axis: "z", value: 90 }] } },
    { id: "slide", kind: "prismatic", a: { instance: "g", placement_mm: [50, 0, 0] }, b: { instance: "b" } },
  ], relations: [{ id: "screw", kind: "screw", driver: { joint: "turn", dof: "rotation" }, driven: { joint: "slide", dof: "translation" }, ratio: 2 / 360 }] }); // 2 mm per turn (ratio in mm per degree)
  expect(screw.message).toBe(""); expect(screw.status).toBe("ok");
  const slid = screw.instances.find((i) => i.id === "b")!;
  expect(slid.placement_mm[2]).toBeCloseTo(0.5, 3); // a quarter turn → 0.5 mm along the slider's z
});
