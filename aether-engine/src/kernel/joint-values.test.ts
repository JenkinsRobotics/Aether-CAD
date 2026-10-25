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

const xyzQuaternion = ([x, y, z]: number[]) => {
  const [c1,c2,c3] = [x,y,z].map(v => Math.cos(v*Math.PI/360));
  const [s1,s2,s3] = [x,y,z].map(v => Math.sin(v*Math.PI/360));
  return [s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3+s1*s2*c3, c1*c2*c3-s1*s2*s3];
};
const ballValues = (angles: number[]) => (["x", "y", "z"] as const).map((axis, i) => ({ name: `rotation_${axis}`, kind: "rotation" as const, axis, value: angles[i] }));
it.each([[20, 30, 40], [25, 90, -65], [-25, -90, 65], [170, 120, -140], [180, 0, 0], [0, 180, 0], [0, 0, -180], [745, -450, 820]])("solves XYZ ball coordinates %j without Euler-branch loss", (x, y, z) => {
  const angles = [x,y,z];
  const job = { ...base, joints: [{ id: "ball", kind: "ball" as const, a: { instance: "g" }, b: { instance: "a" }, parameters: { dofs: ballValues(angles) } }] };
  const snapshot = JSON.stringify(job);
  const result = solveAssemblyJob(job);
  expect(result.status, result.message).toBe("ok");
  const expected = xyzQuaternion(angles), actual = result.instances.find(i => i.id === "a")!.rotation;
  expect(Math.abs(actual.reduce((sum, v, i) => sum + v * expected[i], 0))).toBeCloseTo(1, 9);
  expect(JSON.stringify(job)).toBe(snapshot);
});

it("resolves multi-turn coordinates through out-of-order relations before ball pose evaluation", () => {
  const job = { ...base, instances: [...base.instances, {id: "c", part: "p"}], joints: [
    { id: "root", kind: "revolute" as const, a: {instance:"g"}, b: {instance:"c"}, parameters: {dofs: [{name:"rotation",kind:"rotation",axis:"z",value: 720}]} },
    { id: "ball1", kind: "ball" as const, a: {instance:"g"}, b: {instance:"a"}, parameters: {dofs: ballValues([15, 110, 0]).slice(0, 2)} },
    { id: "ball2", kind: "ball" as const, a: {instance:"g"}, b: {instance:"b"}, parameters: {dofs: ballValues([0, 95, -10]).slice(1)} },
  ], relations: [
    { id: "second", kind: "gear" as const, driver: {joint:"ball1",dof:"rotation_z"}, driven: {joint:"ball2",dof:"rotation_x"}, ratio: 0.5, offset: 12, reversed: true },
    { id: "first", kind: "gear" as const, driver: {joint:"root",dof:"rotation"}, driven: {joint:"ball1",dof:"rotation_z"}, ratio: 0.25, offset: 30 },
  ] };
  const solved = solveAssemblyJob(job);
  expect(solved.status, solved.message).toBe("ok");
  for (const [id, angles] of [["a", [15, 110, 210]], ["b", [-93, 95, -10]]] as const) {
    const expected = xyzQuaternion([...angles]);
    expect(Math.abs(solved.instances.find(i=>i.id===id)!.rotation.reduce((s,v,i)=>s+v*expected[i],0))).toBeCloseTo(1,8);
  }
});

it("refuses conflicting or invalid relations even when all instances are grounded", () => {
  const job = { ...base, instances: base.instances.map(i => ({...i, grounded:true, placement_mm:[0,0,0] as [number,number,number]})), joints: [
    {id:"j1",kind:"revolute" as const,a:{instance:"g"},b:{instance:"a"}},
    {id:"j2",kind:"revolute" as const,a:{instance:"g"},b:{instance:"b"}},
  ], relations: [{id:"conflict",kind:"gear" as const,driver:{joint:"j1",dof:"rotation"},driven:{joint:"j2",dof:"rotation"},ratio:1,offset:45}] };
  const conflict = solveAssemblyJob(job);
  expect(conflict.status).toBe("error"); expect(conflict.instances).toEqual([]);
  expect(conflict.diagnostics.some(d=>d.feature_id==="conflict")).toBe(true);
  for (const relation of [{...job.relations[0],ratio:NaN},{...job.relations[0],driver:{joint:"j1",dof:"bogus"}}]) {
    const result=solveAssemblyJob({...job,relations:[relation]});
    expect(result.status).toBe("error"); expect(result.instances).toEqual([]);
  }
});

it("refuses conflicting held coordinates and unresolved partial ball rotations", () => {
  const result = solveAssemblyJob({...base, joints:[{id:"ball",kind:"ball",a:{instance:"g"},b:{instance:"a"},parameters:{dofs:ballValues([0,0,0]).slice(0,2)}}]});
  expect(result.status).toBe("error"); expect(result.message).toMatch(/resolved X, Y and Z/);
  const conflict = solveAssemblyJob({...base,joints:[
    {id:"j1",kind:"revolute",a:{instance:"g"},b:{instance:"a"},parameters:{dofs:[{name:"rotation",kind:"rotation",axis:"z",value:20}]}},
    {id:"j2",kind:"revolute",a:{instance:"g"},b:{instance:"b"},parameters:{dofs:[{name:"rotation",kind:"rotation",axis:"z",value:50}]}},
  ],relations:[{id:"gear",kind:"gear",driver:{joint:"j1",dof:"rotation"},driven:{joint:"j2",dof:"rotation"},ratio:2}]});
  expect(conflict.status).toBe("error"); expect(conflict.instances).toEqual([]);
});


it.each(["revolute", "cylindrical", "planar", "pin_slot", "parallel"] as const)("holds %s at an exact half-turn", kind => {
  const result = solveAssemblyJob({...base, joints:[{id:"joint",kind,a:{instance:"g"},b:{instance:"a"},parameters:{dofs:[{name:"rotation",kind:"rotation",axis:"z",value:180}]}}]});
  expect(result.status,result.message).toBe("ok");
  expect(Math.abs(result.instances.find(i=>i.id==="a")!.rotation[2])).toBeCloseTo(1,8);
});

it("does not collapse a conflicting held whole turn or ignore a malformed coordinate", () => {
  const joints = ["a","b"].map((id,i)=>({id,kind:"revolute" as const,a:{instance:"g"},b:{instance:id},parameters:{dofs:[{name:"rotation",kind:"rotation" as const,axis:"z" as const,value:i*360}]}}));
  const result=solveAssemblyJob({...base,joints,relations:[{id:"r",kind:"gear",driver:{joint:"a",dof:"rotation"},driven:{joint:"b",dof:"rotation"},ratio:1}]});
  expect(result.status).toBe("error");expect(result.instances).toEqual([]);
  for (const dofs of [[{name:"wrong",kind:"rotation",axis:"z",value:0}], [{...joints[0].parameters.dofs[0],axis:"x"}], [...joints[0].parameters.dofs,...joints[0].parameters.dofs]]) {
    const invalid=solveAssemblyJob({...base,joints:[{...joints[0],parameters:{dofs}}]});
    expect(invalid.status).toBe("error");expect(invalid.instances).toEqual([]);
  }
});
