import { describe, expect, it } from "vitest";
import { solveAssemblyJob } from "@aether/core/kernel";
import { Matrix4, Quaternion, Vector3, Euler } from "three";
import { assemblyJobFor } from "./assembly-job";
import { createRectanglePartDocument } from "./aether-core";

const document = () => createRectanglePartDocument("Bracket", {
  widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
});

const frame = (origin: [number, number, number]) => ({
  origin_m: origin,
  primary_axis_xyz: [0, 0, 1] as [number, number, number],
  secondary_axis_xyz: [1, 0, 0] as [number, number, number],
});

const projection = (over: Record<string, unknown> = {}) => ({
  part_definitions: [
    { id: "p1", name: "Bracket", feature_document: document() },
  ],
  connector_definitions: [
    { id: "c1", part_definition_id: "p1", name: "A", frame_part_local: frame([0.03, 0.03, 0.01]), suppressed: false },
    { id: "c2", part_definition_id: "p1", name: "B", frame_part_local: frame([0, 0, 0]), suppressed: false },
  ],
  instances: [
    { id: "i1", definition_kind: "part", definition_id: "p1", name: "Bracket 1",
      rest_transform: { position_m: [0, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
      grounded: true, suppressed: false },
    { id: "i2", definition_kind: "part", definition_id: "p1", name: "Bracket 2",
      rest_transform: { position_m: [0.12, 0.075, 0.033], rotation_quaternion_xyzw: [0, 0, 0, 1] },
      grounded: false, suppressed: false },
  ],
  mates: [
    { id: "m1", name: "Mate 1", type_id: "fastened", suppressed: false,
      endpoint_a: { instance_id: "i1", connector_definition_id: "c1" },
      endpoint_b: { instance_id: "i2", connector_definition_id: "c2" } },
  ],
  ...over,
}) as never;

describe("turning an assembly document into a solver job", () => {
  it("converts metres to millimetres, which is where this would silently drift", () => {
    // The projection is in metres because it is shared with the animation
    // engine; every length the CAD engine takes is millimetres.
    const { job } = assemblyJobFor(projection());
    expect(job.instances[1].placement_mm).toEqual([120, 75, 33]);
    expect(job.joints[0].a.placement_mm).toEqual([30, 30, 10]);
  });

  it("builds each part once and places every instance of it", () => {
    const { job, complete } = assemblyJobFor(projection());
    expect(complete).toBe(true);
    expect(job.parts).toHaveLength(1);
    expect(job.parts[0].id).toBeTruthy();
    expect(job.instances.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(job.instances[0].grounded).toBe(true);
  });

  it("carries the connector frame, not the part origin", () => {
    // A mate joins connectors. Sending the instance without its frame would
    // mate the parts at their origins and quietly build the wrong assembly.
    const { job } = assemblyJobFor(projection());
    expect(job.joints[0].a.rotation).toHaveLength(4);
    expect(job.joints[0].b.placement_mm).toEqual([0, 0, 0]);
  });

  it("leaves a suppressed instance out, and the mates that needed it", () => {
    const base = projection() as never as Record<string, never>;
    const suppressed = {
      ...base,
      instances: (base.instances as unknown as Record<string, unknown>[]).map((i) =>
        i.id === "i2" ? { ...i, suppressed: true } : i),
    };
    const { job, untranslated, complete } = assemblyJobFor(suppressed as never);
    expect(job.instances.map((i) => i.id)).toEqual(["i1"]);
    expect(job.joints).toHaveLength(0);
    expect(complete).toBe(false);
    expect(untranslated[0].reason).toMatch(/not in the assembly/);
  });

  it("leaves a suppressed mate out but keeps its instances", () => {
    const base = projection() as never as Record<string, never>;
    const off = {
      ...base,
      mates: (base.mates as unknown as Record<string, unknown>[]).map((m) => ({ ...m, suppressed: true })),
    };
    const { job } = assemblyJobFor(off as never);
    expect(job.instances).toHaveLength(2);
    expect(job.joints).toHaveLength(0);
  });

  it("reports a part with no feature document rather than placing nothing", () => {
    const base = projection() as never as Record<string, never>;
    const bare = {
      ...base,
      part_definitions: [{ id: "p1", name: "Bracket", feature_document: undefined }],
    };
    const { job, untranslated, complete } = assemblyJobFor(bare as never);
    expect(job.parts).toHaveLength(0);
    expect(job.instances).toHaveLength(0);
    expect(complete).toBe(false);
    expect(untranslated.some((u) => /feature document/.test(u.reason))).toBe(true);
  });

  it("says sub-assemblies are not solved yet instead of dropping them silently", () => {
    const base = projection() as never as Record<string, never>;
    const nested = {
      ...base,
      instances: [
        ...(base.instances as unknown as Record<string, unknown>[]),
        { id: "i3", definition_kind: "assembly", definition_id: "a1", name: "Sub",
          rest_transform: { position_m: [0, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
          grounded: false, suppressed: false },
      ],
    };
    const { job, untranslated } = assemblyJobFor(nested as never);
    expect(job.instances.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(untranslated.some((u) => /sub-assemblies/.test(u.reason))).toBe(true);
  });

  it("reports a missing saved connector instead of silently mating at the instance origin", () => {
    const base = projection() as never as Record<string, never>;
    const bare = {
      ...base,
      mates: (base.mates as unknown as Record<string, unknown>[]).map((m) => ({
        ...m, endpoint_a: { instance_id: "i1", connector_definition_id: "gone" },
      })),
    };
    const { job, complete, untranslated } = assemblyJobFor(bare as never);
    expect(job.joints).toEqual([]);
    expect(complete).toBe(false);
    expect(untranslated).toEqual([expect.objectContaining({id:"m1", reason:expect.stringMatching(/Connector gone is missing/)})]);
  });
});


it.each([
  [{suppressed:true}, /suppressed/],
  [{part_definition_id:'another-part'}, /different part/],
  [{frame_part_local:frame([NaN,0,0])}, /frame is invalid/],
  [{frame_part_local:{...frame([0,0,0]),primary_axis_xyz:[0,0,0]}}, /frame is invalid/],
  [{frame_part_local:{...frame([0,0,0]),secondary_axis_xyz:[0,0,2]}}, /frame is invalid/],
])('refuses invalid mate connectors %j',(change,reason)=>{
  const base=projection() as any;
  base.connector_definitions[0]={...base.connector_definitions[0],...change};
  const result=assemblyJobFor(base);
  expect(result.complete).toBe(false);
  expect(result.job.joints).toEqual([]);
  expect(result.untranslated).toEqual([expect.objectContaining({id:'m1',reason:expect.stringMatching(reason)})]);
});

it.each([
  ["prismatic", "translation", "translation", 0.025, [30, 30, 35]],
  ["revolute", "rotation", "rotation", Math.PI / 4, [30, 30, 10]],
] as const)("preserves an editable %s DOF's authored value through the actual solver", (type, name, kind, value, expected) => {
  const base = projection() as any;
  const rest = structuredClone(base.instances[1].rest_transform);
  base.mates[0] = { ...base.mates[0], type_id: type, dofs: [{ id: "value", name, kind, state: "free",
    value_rad: kind === "rotation" ? value : null, value_m: kind === "translation" ? value : null }] };
  const translated = assemblyJobFor(base);
  const solved = solveAssemblyJob(translated.job);
  expect(solved.status).toBe("ok");
  const instance = solved.instances.find((i) => i.id === "i2")!;
  instance.placement_mm.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  if (kind === "rotation") expect(Math.abs(instance.rotation[2])).toBeCloseTo(Math.sin(value / 2), 6);
  expect(base.instances[1].rest_transform).toEqual(rest);
  base.mates[0].dofs[0].state = "dependent";
  expect(assemblyJobFor(base).job.joints[0].parameters?.dofs).toBeUndefined();
});


it.each([false, true])("matches saved pin-slot frames with the second endpoint grounded=%s", groundB => {
  const base = projection() as any;
  const world = new Matrix4().compose(new Vector3(17, -21, 9), new Quaternion().setFromEuler(new Euler(0.2, 0.3, -0.4)), new Vector3(1,1,1));
  const connectorA = new Matrix4().compose(new Vector3(30,30,10), new Quaternion().setFromEuler(new Euler(0.3,-0.4,0.5)), new Vector3(1,1,1));
  const connectorB = new Matrix4().compose(new Vector3(7,-9,4), new Quaternion().setFromEuler(new Euler(-0.4,0.5,0.1)), new Vector3(1,1,1));
  const setFrame = (index: number, matrix: Matrix4) => {
    const e=matrix.elements;
    base.connector_definitions[index].frame_part_local = {origin_m:[e[12]/1000,e[13]/1000,e[14]/1000], primary_axis_xyz:[e[8],e[9],e[10]], secondary_axis_xyz:[e[0],e[1],e[2]]};
  };
  setFrame(0,connectorA); setFrame(1,connectorB);
  const fixed=groundB?1:0, moving=groundB?0:1;
  base.instances.forEach((v:any,i:number)=>v.grounded=i===fixed);
  base.instances[fixed].rest_transform={position_m: new Vector3().setFromMatrixPosition(world).toArray().map(v=>v/1000), rotation_quaternion_xyzw:new Quaternion().setFromRotationMatrix(world).toArray()};
  const angle=0.7, travel=25;
  base.mates[0]={...base.mates[0], type_id:"pin_slot",dofs:[
    {id:"turn",name:"rotation",kind:"rotation",state:"free",value_rad:angle,value_m:null},
    {id:"slide",name:"translation",kind:"translation",state:"free",value_m:travel/1000,value_rad:null},
  ]};
  const motion=new Matrix4().makeRotationZ(angle).multiply(new Matrix4().makeTranslation(travel,0,0));
  const expected=groundB ? world.clone().multiply(connectorB).multiply(motion.clone().invert()).multiply(connectorA.clone().invert())
    : world.clone().multiply(connectorA).multiply(motion).multiply(connectorB.clone().invert());
  const translated=assemblyJobFor(base), solved=solveAssemblyJob(translated.job);
  expect(translated.complete).toBe(true); expect(solved.status, solved.message).toBe("ok");
  const actual=solved.instances.find(i=>i.id===base.instances[moving].id)!;
  const p=new Vector3().setFromMatrixPosition(expected).toArray(), q=new Quaternion().setFromRotationMatrix(expected).toArray();
  actual.placement_mm.forEach((v,i)=>expect(v).toBeCloseTo(p[i],5));
  expect(Math.abs(actual.rotation.reduce((sum,v,i)=>sum+v*q[i],0))).toBeCloseTo(1,8);
});

it.each(["driver", "driven"])("preserves pin-slot relation signs and offsets as the %s", slotRole => {
  const base=projection() as any;
  base.connector_definitions.forEach((c:any)=>c.frame_part_local=frame([0,0,0]));
  base.instances.push({...structuredClone(base.instances[1]),id:"i3"});
  const mate=base.mates[0];
  base.mates=[{...mate,type_id:"pin_slot",dofs:[
    {id:"slot-turn",name:"rotation",kind:"rotation",state:slotRole==="driven"?"dependent":"free",value_rad:0.3,value_m:null},
    {id:"slot-slide",name:"translation",kind:"translation",state:"free",value_m:0.02,value_rad:null},
  ]},{...mate,id:"m2",type_id:"revolute",endpoint_b:{...mate.endpoint_b,instance_id:"i3"},dofs:[
    {id:"hinge-turn",name:"rotation",kind:"rotation",state:slotRole==="driver"?"dependent":"free",value_rad:0.3,value_m:null},
  ]}];
  base.relations=[{id:"r",kind:"gear",driver_dof_id:slotRole==="driver"?"slot-turn":"hinge-turn",driven_dof_id:slotRole==="driver"?"hinge-turn":"slot-turn",ratio:-2,offset_rad:0.1,reversed:true}];
  const result=solveAssemblyJob(assemblyJobFor(base).job);
  expect(result.status,result.message).toBe("ok");
  const driven=slotRole==="driver"?"i3":"i2", expected=-0.5;
  const q=result.instances.find(i=>i.id===driven)!.rotation;
  expect(Math.abs(q[2]*Math.sin(expected/2)+q[3]*Math.cos(expected/2))).toBeCloseTo(1,7);
  if(slotRole==="driven") {
    const point=result.instances.find(i=>i.id==="i2")!.placement_mm;
    expect(point[0]).toBeCloseTo(20*Math.cos(expected),5); expect(point[1]).toBeCloseTo(20*Math.sin(expected),5);
  }
});


it("shares derived pose seeds across browser/worker without changing authored placement", () => {
  const base=projection() as any;
  base.instances.forEach((i:any)=>i.solved_world_transform=structuredClone(i.rest_transform));
  base.instances[0].solved_world_transform.position_m=[8,8,8]; // grounded intent always wins
  base.instances[1].solved_world_transform.position_m=[0.03,0.03,0.01];
  const original=JSON.stringify(base);
  const job=assemblyJobFor(base).job;
  expect(job.instances[0].placement_mm).toEqual([0,0,0]);
  expect(job.instances[1].placement_mm).toEqual([30,30,10]);
  expect(solveAssemblyJob(job).status).toBe("ok");
  expect(JSON.stringify(base)).toBe(original);
  // A bad derived guess is not accepted as geometric truth: constraints solve it.
  base.instances[1].solved_world_transform.position_m=[0.5,0.7,0.9];
  const solved=solveAssemblyJob(assemblyJobFor(base).job);
  expect(solved.status,solved.message).toBe("ok");
  solved.instances[1].placement_mm.forEach((v,i)=>expect(v).toBeCloseTo([30,30,10][i],5));
});
