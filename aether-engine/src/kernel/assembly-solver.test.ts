/** The in-process assembly solver against the mates' own definitions and,
 *  when FreeCAD's answers were captured (`freecad-assembly-references.json`,
 *  from AetherStudio/.verification/cad-assembly-oracle-2026-10-20), against
 *  FreeCAD: both solutions must satisfy every mate, and a fully constrained
 *  job must place every instance where FreeCAD did. */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jointResiduals, solvableMateKinds, solveAssemblyJob } from "./assembly-solver";
import type { AssemblyJobInput, AssemblySolution } from "../contracts/assembly";
import fixtures from "./oracle/assembly-fixtures.json";

type Fixture = { name: string; fullyConstrained?: boolean; expectRefusal?: boolean; instances: AssemblyJobInput["instances"]; joints: AssemblyJobInput["joints"] };
const job = (fixture: Fixture): AssemblyJobInput => ({ parts: [{ id: "plate" }], instances: fixture.instances, joints: fixture.joints });
const referencePath = new URL("./oracle/freecad-assembly-references.json", import.meta.url);
const references: Record<string, AssemblySolution> | undefined = existsSync(referencePath) ? JSON.parse(readFileSync(referencePath, "utf8")) : undefined;

const worstResidual = (fixture: Fixture, solution: AssemblySolution) => {
  const poses = new Map(solution.instances.map((i) => [i.id, i]));
  let worst = 0;
  for (const joint of fixture.joints) {
    const a = poses.get(joint.a.instance)!, b = poses.get(joint.b.instance)!;
    const values = jointResiduals(joint.kind, frameFrom(a, joint.a), frameFrom(b, joint.b), joint.parameters);
    worst = Math.max(worst, ...values.map(Math.abs));
  }
  return worst;
};

type V3 = [number, number, number]; type Q = [number, number, number, number];
const qmul = (a: Q, b: Q): Q => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const rotate = (q: Q, v: V3): V3 => { const [x, y, z, w] = q; const t: V3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]; return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])]; };
function frameFrom(pose: { placement_mm: readonly number[]; rotation: readonly number[] }, end: { placement_mm?: readonly number[]; rotation?: readonly number[] }) {
  const p = pose.placement_mm as V3, q = pose.rotation as Q, local = (end.placement_mm ?? [0, 0, 0]) as V3, r = (end.rotation ?? [0, 0, 0, 1]) as Q;
  const world = qmul(q, r), o = rotate(q, local);
  return { o: [p[0] + o[0], p[1] + o[1], p[2] + o[2]] as V3, x: rotate(world, [1, 0, 0]), y: rotate(world, [0, 1, 0]), z: rotate(world, [0, 0, 1]) };
}

describe("in-process assembly solver", () => {
  for (const fixture of (fixtures as unknown as Fixture[])) {
    if (fixture.expectRefusal) {
      it(`refuses ${fixture.name}, which FreeCAD could not honour either`, () => {
        // A coupled mate (gears, belt, screw, rack and pinion) is refused outright. FreeCAD, given
        // the same job, either failed to converge or solved as if the coupling were not there:
        // nothing the product could rely on, so a clear refusal loses nothing.
        const refused = solveAssemblyJob(job(fixture));
        expect(refused.status).toBe("error"); expect(refused.message).toMatch(/unsupported mate kind/); expect(refused.instances).toEqual([]);
        const reference = references?.[fixture.name];
        if (!reference) return;
        if (reference.status !== "ok") { expect(reference.message).toMatch(/did not converge/); return; }
        const without = solveAssemblyJob(job({ ...fixture, joints: fixture.joints.filter((j) => solvableMateKinds.includes(j.kind)) }));
        for (const instance of without.instances) {
          const theirs = reference.instances.find((i) => i.id === instance.id)!;
          for (let k = 0; k < 3; k++) expect(instance.placement_mm[k]).toBeCloseTo(theirs.placement_mm[k], 3);
        }
      });
      continue;
    }
    it(`solves ${fixture.name}${references?.[fixture.name] ? " as FreeCAD does" : ""}`, () => {
      const solution = solveAssemblyJob(job(fixture));
      expect(solution.status, solution.message).toBe("ok");
      expect(solution.instances.map((i) => i.id)).toEqual(fixture.instances.map((i) => i.id));
      for (const instance of solution.instances) expect(Math.hypot(...instance.rotation)).toBeCloseTo(1, 9);
      expect(worstResidual(fixture, solution)).toBeLessThan(1e-4);
      const reference = references?.[fixture.name];
      if (!reference) return;
      // FreeCAD's placements satisfy the same mate definitions: the semantics agree.
      expect(reference.status).toBe("ok");
      expect(worstResidual(fixture, reference)).toBeLessThan(1e-3);
      if (fixture.fullyConstrained) {
        for (const instance of solution.instances) {
          const theirs = reference.instances.find((i) => i.id === instance.id)!;
          for (let k = 0; k < 3; k++) expect(instance.placement_mm[k]).toBeCloseTo(theirs.placement_mm[k], 3);
          expect(Math.abs(instance.rotation.reduce((s, v, k) => s + v * theirs.rotation[k], 0))).toBeCloseTo(1, 6);
        }
      }
    });
  }

  it("holds the first instance when nothing is grounded, and says so", () => {
    const fixture = (fixtures as unknown as Fixture[]).find((f) => f.name === "nothing-grounded")!;
    const solution = solveAssemblyJob(job(fixture));
    expect(solution.diagnostics).toEqual([{ feature_id: "one", severity: "warning", message: "nothing was grounded, so this instance was held fixed" }]);
    expect(solution.instances[0].placement_mm).toEqual([0, 0, 0]);
    expect(solution.instances[1].placement_mm.map((v) => +v.toFixed(6))).toEqual([0, 0, 20]);
  });

  it("refuses what it cannot solve without publishing placements", () => {
    const base = { parts: [{ id: "plate" }], instances: [{ id: "a", part: "plate", grounded: true }, { id: "b", part: "plate", placement_mm: [1, 2, 3] as [number, number, number] }] };
    const coupled = solveAssemblyJob({ ...base, joints: [{ id: "g", kind: "gears", a: { instance: "a" }, b: { instance: "b" } }] });
    expect(coupled.status).toBe("error"); expect(coupled.message).toMatch(/unsupported mate kind 'gears'/); expect(coupled.instances).toEqual([]);
    const missing = solveAssemblyJob({ ...base, joints: [{ id: "m", kind: "fastened", a: { instance: "a" }, b: { instance: "nobody" } }] });
    expect(missing.message).toMatch(/not in the assembly/);
    // Contradictory mates: two fastened joints asking for different placements.
    const contradiction = solveAssemblyJob({ ...base, joints: [
      { id: "m1", kind: "fastened", a: { instance: "a", placement_mm: [0, 0, 20] }, b: { instance: "b" } },
      { id: "m2", kind: "fastened", a: { instance: "a", placement_mm: [0, 0, 50] }, b: { instance: "b" } }] });
    expect(contradiction.status).toBe("error"); expect(contradiction.message).toMatch(/not satisfied after solving/); expect(contradiction.instances).toEqual([]);
    expect(solvableMateKinds).toHaveLength(11);
  });
});
