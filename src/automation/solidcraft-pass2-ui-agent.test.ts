import { describe, expect, it } from "vitest";
import { assemblyAgentInteraction, assemblyAgentTools } from "./assembly-agent";
import { validateToolArguments } from "./tool-arguments";
import { cadReadOnlyInteraction } from "../ai/read-only-tools";
import { featureEditor } from "../modeling/features";
import type { CADAssemblyController } from "../assembly/cad-assembly-controller";
import type { AssemblyProjectionV1 } from "../core/cad-assembly-bridge";

describe("SolidCraft 0.47 Parity Pass 2 — UI Feature Editors & Assembly Agent Tools", () => {
  it("registers emboss, frame-member, frame-end-cap, and upgraded modeled thread feature editors", () => {
    expect(featureEditor("emboss")).toBeDefined();
    expect(featureEditor("frame-member")).toBeDefined();
    expect(featureEditor("frame-end-cap")).toBeDefined();

    const threadEd = featureEditor("thread")!;
    const serialized = threadEd.serialize(
      {
        face: JSON.stringify([{ bodyId: "b1", sourceFeatureId: "e1", surfaceType: "cylinder" }]),
        standard: "ISO metric (typed)",
        designation: "M8",
        sizeFromFace: "false",
        endType: "blind",
        length: "12",
        chamferOn: "false",
        undercutOn: "false",
        splitFace: "false",
        modeled: "true",
        form: "acme",
        leftHand: "true",
        starts: "2",
      },
      {} as any,
    );
    expect(serialized).toMatchObject({ modeled: true, form: "acme", leftHand: true, starts: 2, lengthMillimeters: 12 });

    const frameEd = featureEditor("frame-member")!;
    const frameSerialized = frameEd.serialize(
      {
        pathFeatureId: "sk-1",
        profileId: "shs-40x40x3",
        trimMode: "miter",
        rotationDegrees: "45",
        offsetXMillimeters: "0",
        offsetYMillimeters: "0",
        weldGapMillimeters: "1.5",
      },
      {} as any,
    );
    expect(frameSerialized).toMatchObject({ operation: "new", pathFeatureId: "sk-1", profileId: "shs-40x40x3", trimMode: "miter", rotationDegrees: 45, weldGapMillimeters: 1.5 });
  });

  it("exposes validated read-only assembly mass, IK, sweep, find_limits, and URDF agent tools", async () => {
    const projection: AssemblyProjectionV1 = {
      schema_version: 1,
      workspace_id: "ws-1",
      revision: "r1",
      assembly_id: "asm-1",
      capabilities: {} as any,
      assemblies: [{ id: "asm-1", name: "Robot Arm", description: null, root_instance_ids: ["base", "link1"] }],
      part_definitions: [
        { id: "p-link", name: "Link", part_number: "L-1", description: null, material_id: null, mass_kg: 1.5, source: { kind: "authored", label: "Link" } as any, custom_properties: [] },
      ],
      instances: [
        {
          id: "base", parent_assembly_id: "asm-1", definition_kind: "part", definition_id: "p-link", name: "Base",
          parent_instance_id: null, grounded: true, suppressed: false, visible: true, source_status: "resolved",
          rest_transform: { position_m: [0, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
          solved_world_transform: { position_m: [0, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
        },
        {
          id: "link1", parent_assembly_id: "asm-1", definition_kind: "part", definition_id: "p-link", name: "Link 1",
          parent_instance_id: null, grounded: false, suppressed: false, visible: true, source_status: "resolved",
          rest_transform: { position_m: [0.1, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
          solved_world_transform: { position_m: [0.1, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
        },
      ],
      connector_definitions: [
        { id: "c-base", part_definition_id: "p-link", name: "Joint", frame_part_local: { origin_m: [0, 0, 0], primary_axis_xyz: [0, 0, 1], secondary_axis_xyz: [1, 0, 0] }, provenance: { kind: "manual", stable_feature_id: null, label: null }, suppressed: false },
      ],
      mates: [
        {
          id: "m-rev", name: "Shoulder", type_id: "revolute",
          endpoint_a: { instance_id: "base", connector_definition_id: "c-base" },
          endpoint_b: { instance_id: "link1", connector_definition_id: "c-base" },
          dofs: [{ id: "d1", name: "rotation", kind: "rotation", value_rad: 0, value_m: null, neutral_rad: 0, neutral_m: null, limit_min_rad: -Math.PI / 2, limit_max_rad: Math.PI / 2, limit_min_m: null, limit_max_m: null, state: "free" }],
          controls: [], suppressed: false, solve_state: "satisfied", diagnostic_ids: [],
        },
      ],
      relations: [],
      configurations: [],
      issues: [],
    };

    for (const t of assemblyAgentTools) {
      expect(() => validateToolArguments([t], t.name, { __bogus_arg: 1 })).toThrow(/Unknown argument|missing required/);
    }
    const ro = cadReadOnlyInteraction({ contextKey: "asm", tools: assemblyAgentTools, execute: async () => ({}) });
    for (const name of ["aether_cad_assembly_mass", "aether_cad_assembly_ik", "aether_cad_assembly_sweep", "aether_cad_assembly_find_limits", "aether_cad_assembly_urdf"]) {
      expect(ro.readOnlyTools).toContain(name);
    }

    const controller = { geometryProjection: projection, canUndoRecipe: false, canRedoRecipe: false } as unknown as CADAssemblyController;
    const interaction = assemblyAgentInteraction(controller, "asm", () => "asm", () => false);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      interaction.execute({ id: "c", name, arguments: args }, new AbortController().signal);

    const mass = (await call("aether_cad_assembly_mass")) as any;
    expect(mass.totalMassKg).toBeCloseTo(3.0, 6);
    expect(mass.centerOfMassWorldMm[0]).toBeCloseTo(50, 4);

    const ik = (await call("aether_cad_assembly_ik", { instance_id: "link1", local_point_mm: [100, 0, 0], target_mm: [0, 100, 0] })) as any;
    expect(ik.status).toBe("ok");
    expect(ik.reached).toBe(true);
    expect(ik.jointValues["m-rev"].rotation).toBeCloseTo(90, 1);

    const sweep = (await call("aether_cad_assembly_sweep", { mate_id: "m-rev", dof_name: "rotation", from: -45, to: 45, steps: 5 })) as any;
    expect(sweep.okCount).toBe(5);

    const limits = (await call("aether_cad_assembly_find_limits", { mate_id: "m-rev", dof_name: "rotation", search_min: -120, search_max: 120 })) as any;
    expect(limits.maxFeasible).toBeCloseTo(90, 0);
    expect(limits.minFeasible).toBeCloseTo(-90, 0);

    const urdfRes = (await call("aether_cad_assembly_urdf", { robot_name: "ArmBot" })) as any;
    expect(urdfRes.urdf).toContain('<robot name="ArmBot">');
    expect(urdfRes.urdf).toContain('type="revolute"');
  });
});
