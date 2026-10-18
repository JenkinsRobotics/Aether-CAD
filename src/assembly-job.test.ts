import { describe, expect, it } from "vitest";
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
    expect(job.parts[0].features.length).toBeGreaterThan(0);
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
