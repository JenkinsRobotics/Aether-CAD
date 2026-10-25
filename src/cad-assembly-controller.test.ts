import { describe, expect, it, vi } from "vitest";
import { availableBodies, createRectanglePartDocument, type PartDocument } from "./aether-core";
import type {
  AssemblyProjectionV1,
  AssemblySolutionProjection,
  AssemblyWorkspaceDescriptor,
  BOMProjectionV1,
  MateProjection,
} from "./cad-assembly-bridge";
import {
  CADAssemblyController,
  type AssemblyControllerClient,
} from "./cad-assembly-controller";
import { CADAssemblyWorkspaceStore } from "./cad-assembly-workspace-store";

const transform = {
  position_m: [0, 0, 0] as const,
  rotation_quaternion_xyzw: [0, 0, 0, 1] as const,
};

const descriptor: AssemblyWorkspaceDescriptor = {
  schema_version: 1,
  handle: "workspace-handle-1",
  workspace_id: "workspace-1",
  name: "Drive Module",
  revision: "1",
  graph_sha256: "abc",
  root_assembly_id: "assembly-1",
  assembly_ids: ["assembly-1"],
};

const assembly: AssemblyProjectionV1 = {
  schema_version: 1,
  workspace_id: "workspace-1",
  revision: "1",
  assembly_id: "assembly-1",
  capabilities: {
    can_edit_instances: true,
    can_edit_connectors: true,
    supported_mate_type_ids: ["fastened", "revolute", "prismatic"],
    can_edit_relations: true,
    can_solve_tree: true,
    can_solve_loops: false,
    can_edit_nested_assemblies: false,
    can_project_bom: true,
    can_save_workspace: true,
    unavailable_reasons: [],
  },
  assemblies: [{ id: "assembly-1", name: "Drive Module", description: null, root_instance_ids: ["instance-1"] }],
  part_definitions: [{
    id: "part-1", name: "Bracket", part_number: "BR-1", description: null,
    material_id: null, mass_kg: 0.2,
    source: { kind: "authored", label: "Bracket", asset_ref: null, status: "resolved" },
    custom_properties: [],
  }],
  instances: [{
    id: "instance-1", parent_assembly_id: "assembly-1", definition_kind: "part",
    definition_id: "part-1", name: "Bracket:1", parent_instance_id: null,
    rest_transform: transform, solved_world_transform: transform,
    grounded: true, suppressed: false, visible: true, source_status: "resolved",
  }],
  connector_definitions: [],
  mates: [],
  relations: [],
  configurations: [{ id: "config-1", name: "Default", active: true, suppressed_instance_ids: [], overridden_dof_ids: [] }],
  issues: [],
};

const solution: AssemblySolutionProjection = {
  status: "solved",
  revision: "1",
  instance_world_transforms: [{ instance_id: "instance-1", transform }],
  dof_values: [],
  remaining_free_dof_count: 0,
  residual: 0,
  iterations: 0,
  limit_violations: [],
  diagnostic_ids: [],
};

const bom: BOMProjectionV1 = {
  schema_version: 1,
  assembly_id: "assembly-1",
  revision: "1",
  mode: "hierarchical",
  rows: [{
    row_id: "row-1", parent_row_id: null, part_definition_id: "part-1",
    quantity: 1, part_number: "BR-1", name: "Bracket", description: null,
    material_name: null, unit_mass_kg: 0.2, extended_mass_kg: 0.2,
    source_label: "Bracket", custom_properties: [],
  }],
  total_mass_kg: 0.2,
  diagnostic_ids: [],
};

const lifecycleMate: MateProjection = {
  id: "mate-1",
  name: "Base fixed to arm",
  type_id: "fastened",
  endpoint_a: { instance_id: "instance-1", connector_definition_id: "connector-1" },
  endpoint_b: { instance_id: "instance-2", connector_definition_id: "connector-1" },
  dofs: [],
  controls: [],
  suppressed: false,
  solve_state: "satisfied",
  diagnostic_ids: [],
};

const assemblyWithLifecycleMate: AssemblyProjectionV1 = {
  ...assembly,
  assemblies: [{ ...assembly.assemblies[0], root_instance_ids: ["instance-1", "instance-2"] }],
  instances: [
    ...assembly.instances,
    { ...assembly.instances[0], id: "instance-2", name: "Arm:1", grounded: false },
  ],
  connector_definitions: [{
    id: "connector-1",
    part_definition_id: "part-1",
    name: "Axis",
    frame_part_local: {
      origin_m: [0, 0, 0],
      primary_axis_xyz: [0, 0, 1],
      secondary_axis_xyz: [1, 0, 0],
    },
    provenance: { kind: "manual", stable_feature_id: null, label: "Axis" },
    suppressed: false,
  }],
  mates: [lifecycleMate],
};

const revoluteMate: MateProjection = {
  ...lifecycleMate,
  id: "mate-pivot",
  name: "Arm pivot",
  type_id: "revolute",
  dofs: [{
    id: "dof-pivot",
    name: "rotation",
    kind: "rotation",
    value_rad: 0,
    value_m: null,
    neutral_rad: 0,
    neutral_m: null,
    limit_min_rad: null,
    limit_max_rad: null,
    limit_min_m: null,
    limit_max_m: null,
    state: "free",
  }],
};

const assemblyWithRevoluteMate: AssemblyProjectionV1 = {
  ...assemblyWithLifecycleMate,
  mates: [revoluteMate],
};

function client(overrides: Partial<AssemblyControllerClient> = {}): AssemblyControllerClient {
  let opened = 0;
  return {
    newWorkspace: vi.fn(async () => descriptor),
    openWorkspace: vi.fn(async (encoded: string) => {
      let revision = "1";
      try { revision = JSON.parse(atob(encoded)).revision; } catch { /* Opaque imported file fixture. */ }
      return { ...descriptor, revision, handle: `fixture-candidate-${++opened}` };
    }),
    saveWorkspace: vi.fn(async (handle: string, revision: string) => ({
      handle,
      revision,
      graph_sha256: "abc",
      data_base64: btoa(JSON.stringify({ revision })),
    })),
    describeAssembly: vi.fn(async () => assembly),
    solveAssembly: vi.fn(async () => solution),
    projectBOM: vi.fn(async () => bom),
    previewMate: vi.fn(async () => ({ revision: "1", solution, diagnostics: [] })),
    mutate: vi.fn(async () => ({ handle: descriptor.handle, revision: "1", assembly, solution, bom })),
    release: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("CADAssemblyController", () => {
  it("reports an asynchronous server save failure instead of claiming success", async () => {
    const status = vi.fn();
    const controller = new CADAssemblyController({
      client: client(), store: new CADAssemblyWorkspaceStore(), onStatus: status,
      saveFile: async () => { throw new Error("This file changed on the server."); },
    });
    await controller.newWorkspace("Drive Module");
    status.mockClear();
    await expect(controller.save()).rejects.toThrow("This file changed on the server.");
    expect(status).toHaveBeenLastCalledWith("Assembly save failed: This file changed on the server.", "error");
    expect(status.mock.calls.some(([, tone]) => tone === "success")).toBe(false);
    controller.dispose();
  });
  it("opens one revision-coherent canonical projection and remaps selection", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const bridge = client();
    const changed = vi.fn();
    const controller = new CADAssemblyController({ client: bridge, store, onDocumentChanged: changed });

    await controller.newWorkspace("Drive Module");
    expect(store.snapshot()).toMatchObject({ loadState: "ready", message: "Assembly revision 1" });
    expect(store.snapshot().data?.summary).toMatchObject({ instanceCount: 1, solveStatus: "solved" });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Drive Module", revision: "1" }));

    store.dispatch({ type: "select-entities", ids: ["instance-1"], mode: "single" });
    expect(store.snapshot().data?.inspectorSections[0]).toMatchObject({ id: "instance", label: "Assembly instance" });
    controller.dispose();
  });

  it("passes selected file bytes through Core and downloads only Core-produced bytes", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const bridge = client();
    const saveFile = vi.fn();
    const controller = new CADAssemblyController({ client: bridge, store, saveFile });
    const file = Object.assign(new Blob([Uint8Array.from([1, 2, 3])]), { name: "drive.aether" });

    await controller.openFile(file);
    expect(bridge.openWorkspace).toHaveBeenCalledWith("AQID", expect.any(AbortSignal));
    await controller.save();
    expect(saveFile).toHaveBeenCalledWith("Drive Module.acasm", new TextEncoder().encode(JSON.stringify({ revision: "1" })));
  });

  it("refuses mixed Core revisions without publishing partial data", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const bridge = client({ solveAssembly: vi.fn(async () => ({ ...solution, revision: "2" })) });
    const controller = new CADAssemblyController({ client: bridge, store });

    await expect(controller.newWorkspace("Drive Module")).rejects.toThrow("mixed Assembly revisions");
    expect(store.snapshot()).toMatchObject({ loadState: "error", data: null });
  });

  it("routes selected-instance ground, suppress, and remove edits through revisioned Core mutations", async () => {
    const store = new CADAssemblyWorkspaceStore();
    let currentAssembly = assembly;
    let currentSolution = solution;
    let currentBOM = bom;
    const mutate = vi.fn(async (method: string, params: Readonly<Record<string, unknown>>) => {
      const revision = String(Number(currentAssembly.revision) + 1);
      const selectedID = params.instance_id as string;
      const instances = method === "remove_instance"
        ? currentAssembly.instances.filter(({ id }) => id !== selectedID)
        : currentAssembly.instances.map((instance) => instance.id === selectedID
          ? {
              ...instance,
              grounded: method === "set_instance_grounded" ? params.grounded as boolean : instance.grounded,
              suppressed: method === "set_instance_suppressed" ? params.suppressed as boolean : instance.suppressed,
            }
          : instance);
      currentAssembly = { ...currentAssembly, revision, instances };
      currentSolution = {
        ...currentSolution,
        revision,
        instance_world_transforms: currentSolution.instance_world_transforms
          .filter(({ instance_id }) => instances.some(({ id }) => id === instance_id)),
      };
      currentBOM = {
        ...currentBOM,
        revision,
        rows: method === "remove_instance" ? [] : currentBOM.rows,
      };
      return {
        handle: descriptor.handle,
        revision,
        assembly: currentAssembly,
        solution: currentSolution,
        bom: currentBOM,
      };
    });
    const statuses = vi.fn();
    const controller = new CADAssemblyController({ client: client({ mutate }), store, onStatus: statuses });
    await controller.newWorkspace("Drive Module");
    store.dispatch({ type: "select-entities", ids: ["instance-1"], mode: "single" });

    expect(controller.canEditSelectedInstance).toBe(true);
    await controller.toggleSelectedInstanceGrounded();
    expect(mutate).toHaveBeenNthCalledWith(1, "set_instance_grounded", expect.objectContaining({
      handle: expect.stringMatching(/^fixture-candidate-/),
      expected_revision: "1",
      assembly_id: "assembly-1",
      instance_id: "instance-1",
      grounded: false,
    }), expect.any(AbortSignal));
    expect(controller.selectedInstance?.grounded).toBe(false);

    await controller.toggleSelectedInstanceSuppressed();
    expect(mutate).toHaveBeenNthCalledWith(2, "set_instance_suppressed", expect.objectContaining({
      expected_revision: "2",
      instance_id: "instance-1",
      suppressed: true,
    }), expect.any(AbortSignal));
    expect(controller.selectedInstance?.suppressed).toBe(true);

    await controller.removeSelectedInstance();
    expect(mutate).toHaveBeenNthCalledWith(3, "remove_instance", expect.objectContaining({
      expected_revision: "3",
      instance_id: "instance-1",
    }), expect.any(AbortSignal));
    expect(controller.selectedInstance).toBeNull();
    expect(store.snapshot().selectedEntityIDs.size).toBe(0);
    expect(statuses).toHaveBeenLastCalledWith(
      "Removed Bracket:1 from the canonical Assembly.",
      "success",
    );
  });

  it("publishes Core hierarchical and flattened BOM modes and preserves the mode after mutation", async () => {
    const store = new CADAssemblyWorkspaceStore();
    let revision = "1";
    const projectBOM = vi.fn(async (
      _handle: string,
      _assemblyID: string,
      mode: "hierarchical" | "flattened",
    ) => ({ ...bom, revision, mode }));
    const mutate = vi.fn(async () => {
      revision = "2";
      return {
        handle: descriptor.handle,
        revision,
        assembly: {
          ...assembly,
          revision,
          instances: assembly.instances.map((instance) => ({ ...instance, grounded: false })),
        },
        solution: { ...solution, revision },
        bom: { ...bom, revision, mode: "hierarchical" as const },
      };
    });
    const statuses = vi.fn();
    const controller = new CADAssemblyController({
      client: client({ projectBOM, mutate }),
      store,
      onStatus: statuses,
    });
    await controller.newWorkspace("Drive Module");

    store.dispatch({ type: "select-bom-mode", mode: "flattened" });
    await vi.waitFor(() => expect(store.snapshot().data?.summary.bomMode).toBe("flattened"));
    expect(projectBOM).toHaveBeenLastCalledWith(
      descriptor.handle,
      descriptor.root_assembly_id,
      "flattened",
    );
    store.dispatch({ type: "select-entities", ids: ["instance-1"], mode: "single" });
    await controller.toggleSelectedInstanceGrounded();

    expect(store.snapshot().data?.revision).toBe("2");
    expect(store.snapshot().data?.summary.bomMode).toBe("flattened");
    expect(projectBOM).toHaveBeenLastCalledWith(
      "fixture-candidate-1",
      descriptor.root_assembly_id,
      "flattened",
      expect.any(AbortSignal),
    );
    expect(statuses).toHaveBeenLastCalledWith("Bracket:1 is now free.", "success");
  });

  it("inserts a component with the stable Part ID assigned by Core", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const addedPart = {
      ...assembly.part_definitions[0],
      id: "part-2",
      name: "Bearing",
      part_number: "BRG-6202",
      mass_kg: 0.08,
      source: { ...assembly.part_definitions[0].source, label: "bearing.cadpart" },
    };
    const addedInstance = {
      ...assembly.instances[0],
      id: "instance-2",
      definition_id: "part-2",
      name: "Bearing:1",
      grounded: false,
      rest_transform: { ...transform, position_m: [0.1, 0.2, 0.3] as const },
      solved_world_transform: { ...transform, position_m: [0.1, 0.2, 0.3] as const },
    };
    const mutate = vi.fn()
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "2",
        assembly: { ...assembly, revision: "2", part_definitions: [...assembly.part_definitions, addedPart] },
        solution: { ...solution, revision: "2" },
        bom: { ...bom, revision: "2" },
      })
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "3",
        assembly: {
          ...assembly,
          revision: "3",
          part_definitions: [...assembly.part_definitions, addedPart],
          instances: [...assembly.instances, addedInstance],
        },
        solution: {
          ...solution,
          revision: "3",
          instance_world_transforms: [
            ...solution.instance_world_transforms,
            { instance_id: "instance-2", transform: addedInstance.solved_world_transform },
          ],
        },
        bom: {
          ...bom,
          revision: "3",
          rows: [...bom.rows, {
            ...bom.rows[0],
            row_id: "row-2",
            part_definition_id: "part-2",
            part_number: "BRG-6202",
            name: "Bearing",
            unit_mass_kg: 0.08,
            extended_mass_kg: 0.08,
            source_label: "bearing.cadpart",
          }],
          total_mass_kg: 0.28,
        },
      });
    const statuses = vi.fn();
    const controller = new CADAssemblyController({ client: client({ mutate }), store, onStatus: statuses });
    await controller.newWorkspace("Drive Module");

    expect(controller.canEditInstances).toBe(true);
    await controller.insertComponent({
      partName: " Bearing ",
      partNumber: " BRG-6202 ",
      sourceLabel: " bearing.cadpart ",
      instanceName: " Bearing:1 ",
      massKg: 0.08,
      positionM: [0.1, 0.2, 0.3],
      grounded: false,
    });

    expect(mutate).toHaveBeenNthCalledWith(1, "add_part_definition", expect.objectContaining({
      handle: expect.stringMatching(/^fixture-candidate-/),
      expected_revision: "1",
      assembly_id: "assembly-1",
      part_definition: expect.objectContaining({ name: "Bearing", part_number: "BRG-6202", mass_kg: 0.08 }),
    }), expect.any(AbortSignal));
    expect(mutate).toHaveBeenNthCalledWith(2, "add_instance", expect.objectContaining({
      expected_revision: "2",
      instance: expect.objectContaining({
        definition_id: "part-2",
        name: "Bearing:1",
        rest_transform: { position_m: [0.1, 0.2, 0.3], rotation_quaternion_xyzw: [0, 0, 0, 1] },
      }),
    }), expect.any(AbortSignal));
    expect(store.snapshot().data?.summary).toMatchObject({ instanceCount: 2 });
    expect(store.snapshot().data?.bomRows.at(-1)).toMatchObject({ part_number: "BRG-6202", quantity: 1 });
    expect(statuses).toHaveBeenLastCalledWith(
      "Inserted Bearing:1 into the canonical Assembly.",
      "success",
    );
  });

  it("discards the whole insertion when the occurrence fails", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const addedPart = { ...assembly.part_definitions[0], id: "part-2", name: "Bearing" };
    const mutate = vi.fn()
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "2",
        assembly: { ...assembly, revision: "2", part_definitions: [...assembly.part_definitions, addedPart] },
        solution: { ...solution, revision: "2" },
        bom: { ...bom, revision: "2" },
      })
      .mockRejectedValueOnce(new Error("instance name conflicts"))
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "3",
        assembly: { ...assembly, revision: "3" },
        solution: { ...solution, revision: "3" },
        bom: { ...bom, revision: "3" },
      });
    const statuses = vi.fn();
    const controller = new CADAssemblyController({ client: client({ mutate }), store, onStatus: statuses });
    await controller.newWorkspace("Drive Module");

    await expect(controller.insertComponent({
      partName: "Bearing",
      partNumber: "",
      sourceLabel: "Local Part",
      instanceName: "Bearing:1",
      massKg: null,
      positionM: [0, 0, 0],
      grounded: true,
    })).rejects.toThrow("instance name conflicts");

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(store.snapshot().data?.revision).toBe("1");
    expect(store.snapshot().data?.summary.instanceCount).toBe(1);
    expect(controller.geometryProjection?.part_definitions).toEqual(assembly.part_definitions);
    expect(controller.canUndoRecipe).toBe(false);
    expect(statuses).toHaveBeenLastCalledWith(
      "Assembly action failed: instance name conflicts No edit was applied.", "error");

  });

  it("adds a manual Part-local connector and selects the stable ID returned by Core", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const connector = {
      id: "connector-2",
      part_definition_id: "part-1",
      name: "Shaft axis",
      frame_part_local: {
        origin_m: [0.1, 0.2, 0.3] as const,
        primary_axis_xyz: [0, 0, 1] as const,
        secondary_axis_xyz: [1, 0, 0] as const,
      },
      provenance: {
        kind: "manual" as const,
        stable_feature_id: null,
        label: "Datum A",
      },
      suppressed: false,
    };
    const mutate = vi.fn(async () => ({
      handle: descriptor.handle,
      revision: "2",
      assembly: { ...assembly, revision: "2", connector_definitions: [connector] },
      solution: { ...solution, revision: "2" },
      bom: { ...bom, revision: "2" },
    }));
    const statuses = vi.fn();
    const controller = new CADAssemblyController({ client: client({ mutate }), store, onStatus: statuses });
    await controller.newWorkspace("Drive Module");
    store.dispatch({ type: "select-entities", ids: ["instance-1"], mode: "single" });

    expect(controller.canAddConnector).toBe(true);
    await controller.addConnector({
      name: " Shaft axis ",
      provenanceLabel: " Datum A ",
      originM: [0.1, 0.2, 0.3],
      primaryAxis: "positive-z",
      secondaryAxis: "positive-x",
    });

    expect(mutate).toHaveBeenCalledWith("add_connector", expect.objectContaining({
      expected_revision: "1",
      assembly_id: "assembly-1",
      connector: {
        part_definition_id: "part-1",
        name: "Shaft axis",
        frame_part_local: {
          origin_m: [0.1, 0.2, 0.3],
          primary_axis_xyz: [0, 0, 1],
          secondary_axis_xyz: [1, 0, 0],
        },
        provenance: { kind: "manual", stable_feature_id: null, label: "Datum A" },
      },
    }), expect.any(AbortSignal));
    expect(store.snapshot().selectedEntityIDs).toEqual(new Set(["connector-2"]));
    expect(store.snapshot().data?.inspectorSections[0]).toMatchObject({ id: "connector", label: "Mate connector" });
    expect(statuses).toHaveBeenLastCalledWith("Added Shaft axis to Bracket:1.", "success");
  });

  it("previews without mutation, then commits and selects a Core-owned mate", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const secondPart = { ...assembly.part_definitions[0], id: "part-2", name: "Arm", part_number: "ARM-1" };
    const secondInstance = {
      ...assembly.instances[0],
      id: "instance-2",
      definition_id: "part-2",
      name: "Arm:1",
      grounded: false,
    };
    const baseConnector = {
      id: "connector-1",
      part_definition_id: "part-1",
      name: "Base axis",
      frame_part_local: { origin_m: [0, 0, 0] as const, primary_axis_xyz: [0, 0, 1] as const, secondary_axis_xyz: [1, 0, 0] as const },
      provenance: { kind: "manual" as const, stable_feature_id: null, label: "Base datum" },
      suppressed: false,
    };
    const armConnector = { ...baseConnector, id: "connector-2", part_definition_id: "part-2", name: "Arm axis" };
    const readyAssembly = {
      ...assembly,
      part_definitions: [...assembly.part_definitions, secondPart],
      instances: [...assembly.instances, secondInstance],
      connector_definitions: [baseConnector, armConnector],
      assemblies: [{ ...assembly.assemblies[0], root_instance_ids: ["instance-1", "instance-2"] }],
    };
    const previewMate = vi.fn(async () => ({
      revision: "1",
      solution: { ...solution, remaining_free_dof_count: 0 },
      diagnostics: [],
    }));
    const committedMate = {
      id: "mate-2",
      name: "Base fixed to arm",
      type_id: "fastened",
      endpoint_a: { instance_id: "instance-1", connector_definition_id: "connector-1" },
      endpoint_b: { instance_id: "instance-2", connector_definition_id: "connector-2" },
      dofs: [],
      controls: [],
      suppressed: false,
      solve_state: "satisfied" as const,
      diagnostic_ids: [],
    };
    const mutate = vi.fn(async () => ({
      handle: descriptor.handle,
      revision: "2",
      assembly: { ...readyAssembly, revision: "2", mates: [committedMate] },
      solution: { ...solution, revision: "2", remaining_free_dof_count: 0 },
      bom: { ...bom, revision: "2" },
    }));
    const statuses = vi.fn();
    const controller = new CADAssemblyController({
      client: client({
        describeAssembly: vi.fn(async () => readyAssembly),
        previewMate,
        mutate,
      }),
      store,
      onStatus: statuses,
    });
    await controller.newWorkspace("Drive Module");
    const draft = {
      name: "Base fixed to arm",
      typeID: "fastened" as const,
      endpointA: { instanceID: "instance-1", connectorDefinitionID: "connector-1" },
      endpointB: { instanceID: "instance-2", connectorDefinitionID: "connector-2" },
    };

    expect(controller.canAddMate).toBe(true);
    await expect(controller.previewMate(draft)).resolves.toMatchObject({ revision: "1", solution: { status: "solved" } });
    expect(controller.document?.revision).toBe("1");
    expect(previewMate).toHaveBeenCalledWith(descriptor.handle, "assembly-1", {
      name: "Base fixed to arm",
      type_id: "fastened",
      endpoint_a: { instance_id: "instance-1", connector_definition_id: "connector-1" },
      endpoint_b: { instance_id: "instance-2", connector_definition_id: "connector-2" },
      dofs: [],
      controls: [],
    });

    await controller.addMate(draft);
    expect(mutate).toHaveBeenCalledWith("add_mate", expect.objectContaining({
      expected_revision: "1",
      assembly_id: "assembly-1",
      mate: expect.objectContaining({ name: "Base fixed to arm", type_id: "fastened" }),
    }), expect.any(AbortSignal));
    expect(store.snapshot().selectedEntityIDs).toEqual(new Set(["mate-2"]));
    expect(store.snapshot().data?.inspectorSections[0]).toMatchObject({ id: "mate", badge: "satisfied" });
    expect(statuses).toHaveBeenLastCalledWith(
      "Committed Base fixed to arm to the canonical Assembly.",
      "success",
    );
  });

  it("suppresses, restores, and removes one selected persistent mate", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const statuses = vi.fn();
    const suppressedMate = { ...lifecycleMate, suppressed: true, solve_state: "suppressed" as const };
    const mutate = vi.fn()
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "2",
        assembly: { ...assemblyWithLifecycleMate, revision: "2", mates: [suppressedMate] },
        solution: { ...solution, revision: "2" },
        bom: { ...bom, revision: "2" },
      })
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "3",
        assembly: { ...assemblyWithLifecycleMate, revision: "3" },
        solution: { ...solution, revision: "3" },
        bom: { ...bom, revision: "3" },
      })
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "4",
        assembly: { ...assemblyWithLifecycleMate, revision: "4", mates: [] },
        solution: { ...solution, revision: "4" },
        bom: { ...bom, revision: "4" },
      });
    const controller = new CADAssemblyController({
      client: client({ describeAssembly: vi.fn(async () => assemblyWithLifecycleMate), mutate }),
      store,
      onStatus: statuses,
    });
    await controller.newWorkspace("Drive Module");
    store.dispatch({ type: "select-entities", ids: ["mate-1"], mode: "single" });

    expect(controller.canEditSelectedMate).toBe(true);
    await controller.toggleSelectedMateSuppressed();
    expect(mutate).toHaveBeenNthCalledWith(1, "update_mate", expect.objectContaining({
      expected_revision: "1",
      assembly_id: "assembly-1",
      mate: expect.objectContaining({ id: "mate-1", suppressed: true }),
    }), expect.any(AbortSignal));
    expect(controller.selectedMate?.suppressed).toBe(true);
    expect(store.snapshot().selectedEntityIDs).toEqual(new Set(["mate-1"]));

    await controller.toggleSelectedMateSuppressed();
    expect(mutate).toHaveBeenNthCalledWith(2, "update_mate", expect.objectContaining({
      expected_revision: "2",
      mate: expect.objectContaining({ id: "mate-1", suppressed: false }),
    }), expect.any(AbortSignal));

    await controller.removeSelectedMate();
    expect(mutate).toHaveBeenNthCalledWith(3, "remove_mate", expect.objectContaining({
      expected_revision: "3",
      assembly_id: "assembly-1",
      mate_id: "mate-1",
    }), expect.any(AbortSignal));
    expect(store.snapshot().selectedEntityIDs).toEqual(new Set());
    expect(statuses).toHaveBeenLastCalledWith(
      "Removed Base fixed to arm from the canonical Assembly.",
      "success",
    );

    const failedStore = new CADAssemblyWorkspaceStore();
    const failedStatuses = vi.fn();
    const failedController = new CADAssemblyController({
      client: client({
        describeAssembly: vi.fn(async () => assemblyWithLifecycleMate),
        mutate: vi.fn(async () => { throw new Error("mate DOF is still used by a relation"); }),
      }),
      store: failedStore,
      onStatus: failedStatuses,
    });
    await failedController.newWorkspace("Drive Module");
    failedStore.dispatch({ type: "select-entities", ids: ["mate-1"], mode: "single" });
    await expect(failedController.removeSelectedMate()).rejects.toThrow("still used by a relation");
    expect(failedStore.snapshot().selectedEntityIDs).toEqual(new Set(["mate-1"]));
    expect(failedStatuses).toHaveBeenLastCalledWith(
      "Assembly mate update failed: mate DOF is still used by a relation",
      "error",
    );
  });

  it("sets a selected free mate DOF value and authored limits with explicit units", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const statuses = vi.fn();
    const valueMate = {
      ...revoluteMate,
      dofs: [{ ...revoluteMate.dofs[0], value_rad: Math.PI / 4 }],
    };
    const limitedMate = {
      ...valueMate,
      dofs: [{
        ...valueMate.dofs[0],
        limit_min_rad: -Math.PI / 2,
        limit_max_rad: Math.PI / 2,
      }],
    };
    const mutate = vi.fn()
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "2",
        assembly: { ...assemblyWithRevoluteMate, revision: "2", mates: [valueMate] },
        solution: {
          ...solution,
          revision: "2",
          dof_values: [{ dof_id: "dof-pivot", value_rad: Math.PI / 4, value_m: null }],
          remaining_free_dof_count: 1,
        },
        bom: { ...bom, revision: "2" },
      })
      .mockResolvedValueOnce({
        handle: descriptor.handle,
        revision: "3",
        assembly: { ...assemblyWithRevoluteMate, revision: "3", mates: [limitedMate] },
        solution: {
          ...solution,
          revision: "3",
          dof_values: [{ dof_id: "dof-pivot", value_rad: Math.PI / 4, value_m: null }],
          remaining_free_dof_count: 1,
        },
        bom: { ...bom, revision: "3" },
      });
    const controller = new CADAssemblyController({
      client: client({ describeAssembly: vi.fn(async () => assemblyWithRevoluteMate), mutate }),
      store,
      onStatus: statuses,
    });
    await controller.newWorkspace("Drive Module");
    store.dispatch({ type: "select-entities", ids: ["mate-pivot"], mode: "single" });

    expect(controller.canEditSelectedMateDOF).toBe(true);
    await controller.setSelectedMateDOFValue({
      dofID: "dof-pivot",
      name: "rotation",
      kind: "rotation",
      value: 45,
      limitsEnabled: false,
      minimum: null,
      maximum: null,
    });
    expect(mutate).toHaveBeenNthCalledWith(1, "set_dof_value", expect.objectContaining({
      expected_revision: "1",
      assembly_id: "assembly-1",
      dof_id: "dof-pivot",
      value_rad: Math.PI / 4,
    }), expect.any(AbortSignal));
    expect(controller.selectedMateDOF?.value_rad).toBe(Math.PI / 4);

    await controller.updateSelectedMateDOFLimits({
      dofID: "dof-pivot",
      name: "rotation",
      kind: "rotation",
      value: 45,
      limitsEnabled: true,
      minimum: -90,
      maximum: 90,
    });
    expect(mutate).toHaveBeenNthCalledWith(2, "update_mate", expect.objectContaining({
      expected_revision: "2",
      assembly_id: "assembly-1",
      mate: expect.objectContaining({
        id: "mate-pivot",
        dofs: [expect.objectContaining({
          value_rad: Math.PI / 4,
          limit_min_rad: -Math.PI / 2,
          limit_max_rad: Math.PI / 2,
        })],
      }),
    }), expect.any(AbortSignal));
    expect(store.snapshot().selectedEntityIDs).toEqual(new Set(["mate-pivot"]));
    expect(statuses).toHaveBeenLastCalledWith("rotation limits are now enabled.", "success");

    const dependentStore = new CADAssemblyWorkspaceStore();
    const dependentController = new CADAssemblyController({
      client: client({
        describeAssembly: vi.fn(async () => ({
          ...assemblyWithRevoluteMate,
          mates: [{
            ...revoluteMate,
            dofs: [{ ...revoluteMate.dofs[0], state: "dependent" as const }],
          }],
        })),
      }),
      store: dependentStore,
    });
    await dependentController.newWorkspace("Drive Module");
    dependentStore.dispatch({ type: "select-entities", ids: ["mate-pivot"], mode: "single" });
    expect(dependentController.canEditSelectedMateDOF).toBe(false);
  });

  it("edits an explicitly chosen coordinate on a multi-DOF mate and preserves its siblings", async () => {
    const store=new CADAssemblyWorkspaceStore();
    const dofs=['x','y','z'].map((axis,i)=>({...revoluteMate.dofs[0],id:`ball-${axis}`,name:`rotation_${axis}`,value_rad:i/10}));
    const mate={...revoluteMate,type_id:'ball',dofs};
    let current:AssemblyProjectionV1={...assemblyWithRevoluteMate,capabilities:{...assembly.capabilities,supported_mate_type_ids:['ball']},mates:[mate]};
    const mutate=vi.fn(async(method:string,params:Readonly<Record<string,unknown>>)=>{
      const revision=String(Number(current.revision)+1);
      const authored=params.mate as MateProjection | undefined;
      const next=method==='update_mate'?{...current.mates[0],...authored,dofs:current.mates[0].dofs.map(dof=>({...dof,...authored!.dofs.find(next=>next.name===dof.name)}))}:{...current.mates[0],dofs:current.mates[0].dofs.map(dof=>dof.id===params.dof_id?{...dof,value_rad:params.value_rad as number}:dof)};
      current={...current,revision,mates:[next]};
      return {handle:descriptor.handle,revision,assembly:current,solution:{...solution,revision},bom:{...bom,revision}};
    });
    const controller=new CADAssemblyController({client:client({describeAssembly:vi.fn(async()=>current),mutate}),store});
    await controller.newWorkspace('Ball'); store.dispatch({type:'select-entities',ids:[mate.id],mode:'single'});
    expect(controller.canEditSelectedMateDOF).toBe(true);
    expect(store.snapshot().data?.selectedMateDOFs?.map(d=>d.id)).toEqual(['ball-x','ball-y','ball-z']);
    const draft={dofID:'ball-y',name:'rotation_y',kind:'rotation' as const,value:110,limitsEnabled:false,minimum:null,maximum:null};
    await controller.setSelectedMateDOFValue(draft);
    await controller.updateSelectedMateDOFLimits({...draft,limitsEnabled:true,minimum:-120,maximum:120});
    expect(controller.selectedMate?.dofs[1]).toMatchObject({value_rad:110*Math.PI/180,limit_min_rad:-120*Math.PI/180,limit_max_rad:120*Math.PI/180});
    expect(controller.selectedMate?.dofs[0]).toEqual(dofs[0]);expect(controller.selectedMate?.dofs[2]).toEqual(dofs[2]);
    await expect(controller.setSelectedMateDOFValue({...draft,dofID:'another-mate'})).rejects.toThrow(/free coordinate/);
    controller.dispose();
  });

  it("adds a typed relation and selects only Core's returned stable ID", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const secondMate = {
      ...revoluteMate,
      id: "mate-pivot-2",
      name: "Second pivot",
      dofs: [{ ...revoluteMate.dofs[0], id: "dof-pivot-2" }],
    };
    const readyAssembly = { ...assemblyWithRevoluteMate, mates: [revoluteMate, secondMate] };
    const relation = {
      id: "relation-1",
      kind: "gear",
      driver_dof_id: "dof-pivot",
      driven_dof_id: "dof-pivot-2",
      ratio: -2,
      offset_rad: Math.PI / 12,
      offset_m: null,
      reversed: true,
      suppressed: false,
    };
    const mutate = vi.fn(async () => ({
      handle: descriptor.handle,
      revision: "2",
      assembly: {
        ...readyAssembly,
        revision: "2",
        mates: [revoluteMate, {
          ...secondMate,
          dofs: [{ ...secondMate.dofs[0], state: "dependent" as const }],
        }],
        relations: [relation],
      },
      solution: { ...solution, revision: "2", remaining_free_dof_count: 1 },
      bom: { ...bom, revision: "2" },
    }));
    const statuses = vi.fn();
    const controller = new CADAssemblyController({
      client: client({ describeAssembly: vi.fn(async () => readyAssembly), mutate }),
      store,
      onStatus: statuses,
    });
    await controller.newWorkspace("Drive Module");

    expect(controller.canAddRelation).toBe(true);
    await controller.addRelation({
      kind: "gear",
      driverDOFID: "dof-pivot",
      drivenDOFID: "dof-pivot-2",
      ratio: 2,
      offset: 15,
      reversed: true,
    });
    expect(mutate).toHaveBeenCalledWith("add_relation", expect.objectContaining({
      expected_revision: "1",
      assembly_id: "assembly-1",
      relation: expect.objectContaining({
        kind: "gear",
        driver_dof_id: "dof-pivot",
        driven_dof_id: "dof-pivot-2",
        ratio: -2,
        offset_rad: Math.PI / 12,
      }),
    }), expect.any(AbortSignal));
    expect(store.snapshot().selectedEntityIDs).toEqual(new Set(["relation-1"]));
    expect(store.snapshot().data?.inspectorSections[0]).toMatchObject({ id: "relation", badge: "gear" });
    expect(statuses).toHaveBeenLastCalledWith("Added gear relation to the canonical Assembly.", "success");
  });

  it("keeps the selected instance when Core rejects an edit", async () => {
    const store = new CADAssemblyWorkspaceStore();
    const statuses = vi.fn();
    const controller = new CADAssemblyController({
      client: client({ mutate: vi.fn(async () => { throw new Error("linked workspace is read-only"); }) }),
      store,
      onStatus: statuses,
    });
    await controller.newWorkspace("Drive Module");
    store.dispatch({ type: "select-entities", ids: ["instance-1"], mode: "single" });

    await expect(controller.toggleSelectedInstanceGrounded()).rejects.toThrow("read-only");
    expect(controller.selectedInstance?.id).toBe("instance-1");
    expect(store.snapshot().selectedEntityIDs).toEqual(new Set(["instance-1"]));
    expect(statuses).toHaveBeenLastCalledWith(
      "Assembly component update failed: linked workspace is read-only",
      "error",
    );
  });
});

describe('atomic assembly recipe transactions', () => {
  function setup(composeOverride?: (...args:any[])=>Promise<any>) {
    let revision='1';
    const bridge=client({
      openWorkspace:vi.fn(async(encoded:string)=>{revision=encoded==='after'?'2':'1';return {...descriptor,revision,handle:'fresh-'+revision};}),
      describeAssembly:vi.fn(async()=>({...assembly,revision})),
      solveAssembly:vi.fn(async()=>({...solution,revision})),
      projectBOM:vi.fn(async()=>({...bom,revision})),
    });
    const compose=vi.fn(composeOverride??(async()=>({data_base64:'after',revision:'2',assembly_id:'assembly-1',ids:{parts:{},instances:{new:'instance-2'},mates:{}},instance_count:2,evaluated_parts:[],engine:'FreeCAD'})));
    let writable=true;
    const controller=new CADAssemblyController({client:bridge,store:new CADAssemblyWorkspaceStore(),compose,writable:()=>writable});
    return {controller,bridge,compose,lock:()=>{writable=false;}};
  }
  it('commits one coherent archive, preserves identity, and supports undo/redo',async()=>{
    const {controller,bridge,compose}=setup();await controller.newWorkspace('Assembly');
    const result=await controller.composeRecipe({version:1});
    expect(compose.mock.calls[0][0]).toMatchObject({expected_revision:'1',assembly_id:'assembly-1'});
    expect(result).not.toHaveProperty('data_base64');
    expect(controller.document?.revision).toBe('2');expect(controller.canUndoRecipe).toBe(true);
    expect(bridge.release).toHaveBeenCalledWith('workspace-handle-1');
    await controller.undoRecipe(-1);expect(controller.document?.revision).toBe('1');expect(controller.canRedoRecipe).toBe(true);
    await controller.undoRecipe(1);expect(controller.document?.revision).toBe('2');expect(controller.canUndoRecipe).toBe(true);
    await controller.refresh();expect(controller.canUndoRecipe).toBe(false);
    controller.dispose();
  });
  it('leaves the current document untouched when geometry qualification fails',async()=>{
    const {controller,bridge}=setup(async()=>{throw Error('Native rebuild failed');});await controller.newWorkspace('Assembly');
    const source=controller.geometryProjection;
    await expect(controller.composeRecipe({})).rejects.toThrow('Native rebuild failed');
    expect(controller.geometryProjection).toBe(source);expect(bridge.openWorkspace).not.toHaveBeenCalled();expect(controller.canUndoRecipe).toBe(false);
    controller.dispose();
  });
  it.each(['edit','cancel','readonly'] as const)('refuses a candidate after %s during rebuilding',async(kind)=>{
    let finish!:(value:any)=>void;
    const {controller,bridge,lock}=setup(()=>new Promise(resolve=>{finish=resolve;}));
    await controller.newWorkspace('Assembly');const abort=new AbortController();
    const pending=controller.composeRecipe({},abort.signal);await Promise.resolve();
    await expect(controller.composeRecipe({})).rejects.toThrow(/already rebuilding/);
    await expect(controller.mutate('remove_instance',{instance_id:'instance-1'})).rejects.toThrow(/already rebuilding/);
    expect(bridge.mutate).not.toHaveBeenCalled();
    if(kind==='edit')await controller.refresh();if(kind==='cancel')abort.abort();if(kind==='readonly')lock();
    const source=controller.geometryProjection;
    finish({data_base64:'after',revision:'2',assembly_id:'assembly-1',ids:{instances:{}}});
    await expect(pending).rejects.toThrow();expect(controller.geometryProjection).toBe(source);
    expect(bridge.release).toHaveBeenCalledWith('fresh-2');expect(controller.canUndoRecipe).toBe(false);
    controller.dispose();
  });
  it('rejects an archive with mismatched identity',async()=>{
    const {controller,bridge}=setup();await controller.newWorkspace('Assembly');
    vi.mocked(bridge.openWorkspace).mockResolvedValue({...descriptor,workspace_id:'other',handle:'bad'});
    await expect(controller.composeRecipe({})).rejects.toThrow(/identity/);
    expect(controller.document?.workspaceID).toBe('workspace-1');expect(bridge.release).toHaveBeenCalledWith('bad');controller.dispose();
  });
  it('does not overwrite a pending component edit or publish it into a different workspace',async()=>{
    const {controller,bridge,compose}=setup();await controller.newWorkspace('Assembly');
    let finish!:(value:any)=>void;
    vi.mocked(bridge.mutate).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=controller.mutate('remove_instance',{instance_id:'instance-1'});
    await expect(controller.composeRecipe({})).rejects.toThrow(/already rebuilding/);
    expect(compose).not.toHaveBeenCalled();
    await controller.close();
    finish({handle:descriptor.handle,revision:'2',assembly:{...assembly,revision:'2'},solution:{...solution,revision:'2'},bom:{...bom,revision:'2'}});
    await expect(pending).rejects.toThrow(/changed while editing/);
    expect(controller.geometryProjection).toBeNull();controller.dispose();
  });

  it("edits part properties, copies occurrences, and moves bodies into components", async () => {
    const doc = { ...createRectanglePartDocument("Bracket", { widthMillimeters: 20, heightMillimeters: 10, depthMillimeters: 5 }), documentId: "part-1" };
    (doc.features as unknown[]).push(
      { ...doc.features[0], id: "s2", name: "Sketch 2" },
      { id: "e2", type: "extrude", name: "Boss", profileFeatureId: "s2", operation: "new", distanceMillimeters: 12, suppressed: false },
    );
    const [first, second] = availableBodies(doc).map((b) => b.id);
    const store = new CADAssemblyWorkspaceStore();
    let current: AssemblyProjectionV1 = { ...assembly, part_definitions: [{ ...assembly.part_definitions[0], feature_document: doc }] };
    const mutate = vi.fn(async (method: string, params: Readonly<Record<string, unknown>>) => {
      const revision = String(Number(current.revision) + 1);
      if (method === "add_part_definition") current = { ...current, part_definitions: [...current.part_definitions, { ...(params.part_definition as object), id: `part-${current.part_definitions.length + 1}` } as never] };
      if (method === "update_part_definition") { const next = params.part_definition as { id: string }; current = { ...current, part_definitions: current.part_definitions.map((p) => p.id === next.id ? next as never : p) }; }
      if (method === "add_instance") { const next = params.instance as { rest_transform: unknown }; current = { ...current, instances: [...current.instances, { parent_instance_id: null, solved_world_transform: next.rest_transform, suppressed: false, visible: true, source_status: "resolved", ...next, id: `instance-${current.instances.length + 1}` } as never] }; }
      current = { ...current, revision };
      return { handle: descriptor.handle, revision, assembly: current, solution: { ...solution, revision, instance_world_transforms: current.instances.map((i) => ({ instance_id: i.id, transform: i.solved_world_transform })) }, bom: { ...bom, revision } };
    });
    const statuses = vi.fn();
    const controller = new CADAssemblyController({ client: client({ mutate, describeAssembly: vi.fn(async () => current) }), store, onStatus: statuses });
    await controller.newWorkspace("Drive Module");
    store.dispatch({ type: "select-entities", ids: ["instance-1"], mode: "single" });

    await controller.updatePartProperties({ partNumber: " BR-2 ", description: "Left bracket", properties: "finish = anodised" });
    expect(mutate).toHaveBeenLastCalledWith("update_part_definition", expect.objectContaining({ part_definition: expect.objectContaining({ id: "part-1", part_number: "BR-2", description: "Left bracket", custom_properties: [{ key: "finish", value: "anodised" }], feature_document: doc }) }), expect.any(AbortSignal));

    await controller.addLinkedCopyOfSelectedInstance();
    expect(mutate).toHaveBeenLastCalledWith("add_instance", expect.objectContaining({ instance: expect.objectContaining({ definition_id: "part-1", name: "Bracket:2" }) }), expect.any(AbortSignal));

    await controller.copySelectedInstanceIndependent();
    expect(mutate).toHaveBeenNthCalledWith(3, "add_part_definition", expect.objectContaining({ part_definition: expect.objectContaining({ name: "Bracket copy", part_number: "BR-2" }) }), expect.any(AbortSignal));
    expect((mutate.mock.calls[2][1].part_definition as any).feature_document).toBeUndefined();
    expect(mutate).toHaveBeenNthCalledWith(4, "update_part_definition", expect.objectContaining({ part_definition: expect.objectContaining({ id: "part-2", feature_document: { ...doc, documentId: "part-2", name: "Bracket copy" } }) }), expect.any(AbortSignal));
    expect(mutate).toHaveBeenNthCalledWith(5, "add_instance", expect.objectContaining({ instance: expect.objectContaining({ definition_id: "part-2", name: "Bracket:1 copy" }) }), expect.any(AbortSignal));

    await controller.moveBodiesToComponent({ sourceInstanceID: "instance-1", bodyIDs: [second], sketchIDs: [], target: "new", name: "" });
    const bossDefinition = current.part_definitions.find((p) => p.name === "Body 2")!;
    expect((bossDefinition.feature_document as PartDocument).documentId).toBe(bossDefinition.id);
    expect((bossDefinition.feature_document as PartDocument).features.map((f) => f.id)).toEqual(["s2", "e2"]);
    expect((current.part_definitions[0].feature_document as PartDocument).features.map((f) => f.id)).toEqual(doc.features.slice(0, 2).map((f) => f.id));
    expect(current.instances.at(-1)).toMatchObject({ name: "Body 2:1", definition_id: bossDefinition.id });

    // Move the boss back into the bracket, into an existing occurrence.
    const bossInstance = current.instances.at(-1)!;
    await controller.moveBodiesToComponent({ sourceInstanceID: bossInstance.id, bodyIDs: [availableBodies(bossDefinition.feature_document as PartDocument)[0].id], sketchIDs: [], target: "instance-1", name: "" });
    expect((current.part_definitions[0].feature_document as PartDocument).features.map((f) => f.id)).toEqual([...doc.features.slice(0, 2).map((f) => f.id), "s2", "e2"]);
    expect((current.part_definitions.find((p) => p.id === bossDefinition.id)!.feature_document as PartDocument).features).toEqual([]);
    expect(availableBodies(current.part_definitions[0].feature_document as PartDocument).map((b) => b.id)).toEqual([first, second]);
    expect(statuses).toHaveBeenLastCalledWith(expect.stringMatching(/^Moved 1 body and 0 sketches/), "success");
  });

  it("inserts a standard part and resizes it in place", async () => {
    const store = new CADAssemblyWorkspaceStore();
    let current: AssemblyProjectionV1 = assembly;
    const mutate = vi.fn(async (method: string, params: Readonly<Record<string, unknown>>) => {
      const revision = String(Number(current.revision) + 1);
      if (method === "add_part_definition") current = { ...current, part_definitions: [...current.part_definitions, { ...(params.part_definition as object), id: `part-${current.part_definitions.length + 1}` } as never] };
      if (method === "update_part_definition") { const next = params.part_definition as { id: string }; current = { ...current, part_definitions: current.part_definitions.map((p) => p.id === next.id ? next as never : p) }; }
      if (method === "add_instance") { const next = params.instance as { rest_transform: unknown }; current = { ...current, instances: [...current.instances, { parent_instance_id: null, solved_world_transform: next.rest_transform, suppressed: false, visible: true, source_status: "resolved", ...next, id: `instance-${current.instances.length + 1}` } as never] }; }
      current = { ...current, revision };
      return { handle: descriptor.handle, revision, assembly: current, solution: { ...solution, revision }, bom: { ...bom, revision } };
    });
    const controller = new CADAssemblyController({ client: client({ mutate, describeAssembly: vi.fn(async () => current) }), store, onStatus: vi.fn() });
    await controller.newWorkspace("Drive Module");
    await controller.insertStandardPart({ family: "hex_bolt", size: "M6", length: 20 }, [10, 0, 0]);
    const part = current.part_definitions.at(-1)!;
    expect((part.feature_document as PartDocument).documentId).toBe(part.id);
    expect(part).toMatchObject({ name: "ISO 4017 M6 × 20", part_number: "ISO 4017 M6 × 20" });
    expect(part.custom_properties).toEqual([{ key: "standard_part_family", value: "hex_bolt" }, { key: "standard_part_size", value: "M6" }, { key: "standard_part_length", value: "20" }]);
    expect(current.instances.at(-1)).toMatchObject({ name: "ISO 4017 M6 × 20:1", rest_transform: { position_m: [0.01, 0, 0] } });
    store.dispatch({ type: "select-entities", ids: [current.instances.at(-1)!.id], mode: "single" });
    await controller.resizeSelectedStandardPart({ family: "hex_bolt", size: "M8", length: 30 });
    expect(current.part_definitions.at(-1)).toMatchObject({ id: part.id, name: "ISO 4017 M8 × 30" });
    expect((current.part_definitions.at(-1)!.feature_document as { name: string }).name).toBe("ISO 4017 M8 × 30");
    expect((current.part_definitions.at(-1)!.feature_document as PartDocument).documentId).toBe(part.id);
    await expect(controller.resizeSelectedStandardPart({ family: "hex_nut", size: "M8" })).rejects.toThrow(/keeps the family/);
  });
});


describe('isolated explicit Assembly edits', () => {
  function setup(validateContacts?: (projection: AssemblyProjectionV1) => Promise<void>) {
    type State={revision:string;name:string;parts?:AssemblyProjectionV1['part_definitions'];extra?:AssemblyProjectionV1['instances']};
    const states=new Map<string,State>([[descriptor.handle,{revision:'1',name:'Bracket:1'}]]);
    let serial=0,writable=true;
    const state=(handle:string)=>{const s=states.get(handle);if(!s)throw Error('Released handle');return s;};
    const projection=(handle:string)=>({...assembly,revision:state(handle).revision,part_definitions:state(handle).parts??assembly.part_definitions,contacts_enabled:!!validateContacts,instances:[{...assembly.instances[0],name:state(handle).name},...(validateContacts?[{...assembly.instances[0],id:'instance-2'}]:[]),...(state(handle).extra??[])]});
    const bridge=client({
      openWorkspace:vi.fn(async(encoded:string)=>{const s=JSON.parse(encoded) as State;const handle='candidate-'+(++serial);states.set(handle,s);return {...descriptor,revision:s.revision,handle};}),
      saveWorkspace:vi.fn(async(handle:string,revision:string)=>{const s=state(handle);if(revision!==s.revision)throw Error('Revision changed');return {handle,revision,graph_sha256:'hash',data_base64:JSON.stringify(s)};}),
      describeAssembly:vi.fn(async(handle:string)=>projection(handle)),
      solveAssembly:vi.fn(async(handle:string)=>({...solution,revision:state(handle).revision})),
      projectBOM:vi.fn(async(handle:string,_id:string,mode:"hierarchical"|"flattened")=>({...bom,mode,revision:state(handle).revision})),
      mutate:vi.fn(async(method,params)=>{
        const s=state(params.handle);if(s.revision!==params.expected_revision)throw Error('Revision changed');
        if(method==='update_instance')s.name=(params.instance as any)?.name??s.name;
        if(method==='add_part_definition')s.parts=[...(s.parts??assembly.part_definitions),{...(params.part_definition as any),id:'part-copy'}];
        if(method==='add_instance')s.extra=[...(s.extra??[]),{...assembly.instances[0],...(params.instance as any),id:'instance-copy'}];
        s.revision=String(Number(s.revision)+1);
        return {handle:params.handle,revision:s.revision,assembly:projection(params.handle),solution:{...solution,revision:s.revision},bom:{...bom,revision:s.revision}};
      }),
      release:vi.fn(async(handle:string)=>{states.delete(handle);}),
    });
    const store=new CADAssemblyWorkspaceStore(),changed=vi.fn();
    const controller=new CADAssemblyController({client:bridge,store,writable:()=>writable,validateContacts,onDocumentChanged:changed});
    return {controller,bridge,states,store,changed,lock:()=>{writable=false;}};
  }
  it('edits a distinct handle, publishes one coherent result and reopens history without overwriting live intent',async()=>{
    const {controller,bridge,states}=setup();await controller.newWorkspace('Assembly');
    await controller.editAtomically('update_instance',{instance:{id:'instance-1',name:'Edited'}},'1');
    expect(bridge.mutate).toHaveBeenCalledWith('update_instance',expect.objectContaining({handle:'candidate-1',expected_revision:'1',assembly_id:'assembly-1'}),expect.any(AbortSignal));
    expect(controller.geometryProjection?.instances[0].name).toBe('Edited');expect(controller.solutionProjection?.revision).toBe('2');expect(controller.bomProjection?.revision).toBe('2');
    expect([...states.keys()]).toEqual(['candidate-1']);expect(controller.canUndoRecipe).toBe(true);
    await controller.undoRecipe(-1);expect(controller.geometryProjection?.instances[0].name).toBe('Bracket:1');
    await controller.undoRecipe(1);expect(controller.geometryProjection?.instances[0].name).toBe('Edited');
    expect(states.size).toBe(1);controller.dispose();
  });
  it('shares multiple UI/agent edits, preserves history through BOM views, and branches safely', async () => {
    const {controller,bridge,states}=setup(); await controller.newWorkspace('Assembly');
    const update=(name:string)=>controller.mutate('update_instance',{instance:{id:'instance-1',name}});
    await update('UI one');
    await controller.editAtomically('update_instance',{instance:{id:'instance-1',name:'Agent two'}},'2');
    await update('UI three');
    await controller.selectBOMMode('flattened'); expect(controller.canUndoRecipe).toBe(true);
    for (const name of ['Agent two','UI one','Bracket:1']) {
      await controller.undoRecipe(-1); expect(controller.geometryProjection?.instances[0].name).toBe(name);
      expect(controller.bomProjection?.mode).toBe('flattened'); expect(states.size).toBe(1);
    }
    expect(controller.canUndoRecipe).toBe(false);
    await controller.undoRecipe(1); await controller.undoRecipe(1);
    expect(controller.geometryProjection?.instances[0].name).toBe('Agent two');
    const before=controller.geometryProjection;
    vi.mocked(bridge.mutate).mockRejectedValueOnce(Error('Refused edit'));
    await expect(update('Failure')).rejects.toThrow('Refused edit');
    expect(controller.geometryProjection).toBe(before); expect(controller.canRedoRecipe).toBe(true);
    await update('New branch'); expect(controller.canRedoRecipe).toBe(false);
    await controller.undoRecipe(-1); expect(controller.geometryProjection?.instances[0].name).toBe('Agent two');
    await controller.close(); expect(controller.canUndoRecipe).toBe(false); expect(controller.canRedoRecipe).toBe(false);
    expect(states.size).toBe(0); controller.dispose();
  });

  it('commits a multi-operation independent copy once and undoes its definition and occurrence together',async()=>{
    const {controller,store,bridge,states,changed}=setup();await controller.newWorkspace('Assembly');
    await controller.mutate('update_instance',{instance:{id:'instance-1',name:'Before copy'}});
    store.dispatch({type:'select-entities',ids:['instance-1'],mode:'single'});changed.mockClear();
    await controller.copySelectedInstanceIndependent();
    expect(controller.geometryProjection?.part_definitions).toHaveLength(2);
    expect(controller.geometryProjection?.instances).toHaveLength(2);expect(changed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.mutate).mock.calls.slice(-2).map(([,params])=>params.handle)).toEqual(['candidate-2','candidate-2']);
    await controller.undoRecipe(-1);expect(controller.geometryProjection?.part_definitions).toHaveLength(1);expect(controller.geometryProjection?.instances).toHaveLength(1);
    expect(controller.geometryProjection?.instances[0].name).toBe('Before copy');
    await controller.undoRecipe(-1);expect(controller.geometryProjection?.instances[0].name).toBe('Bracket:1');
    await controller.undoRecipe(1);await controller.undoRecipe(1);expect(controller.geometryProjection?.instances).toHaveLength(2);
    expect(states.size).toBe(1);controller.dispose();
  });
  it.each(['native','contact','readonly','close'] as const)('does not publish intermediate compound state after %s failure',async(mode)=>{
    const validate=vi.fn(async()=>{});
    const {controller,store,bridge,states,changed,lock}=setup(mode==='contact'?validate:undefined);
    await controller.newWorkspace('Assembly');store.dispatch({type:'select-entities',ids:['instance-1'],mode:'single'});
    const before=controller.geometryProjection;changed.mockClear();
    let finish!:()=>void;
    const mutate=vi.mocked(bridge.mutate).getMockImplementation()!;
    vi.mocked(bridge.mutate).mockImplementation(async(method,params,signal)=>{
      if(method==='add_instance'){
        await new Promise<void>(resolve=>{finish=resolve;});
        if(mode==='native')throw Error('Insertion refused');
      }
      return mutate(method,params,signal);
    });
    if(mode==='contact')validate.mockRejectedValue(Error('Parts overlap'));
    const pending=controller.copySelectedInstanceIndependent();
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    expect(controller.geometryProjection).toBe(before);expect(changed).not.toHaveBeenCalled();
    await expect(controller.mutate('update_instance',{})).rejects.toThrow(/already rebuilding/);
    if(mode==='readonly')lock();if(mode==='close')await controller.close();
    finish();await expect(pending).rejects.toThrow();
    expect(controller.geometryProjection).toBe(mode==='close'?null:before);expect(controller.canUndoRecipe).toBe(false);
    expect(states.size).toBe(mode==='close'?0:1);controller.dispose();
  });

  it('validates contact-enabled UI and agent edits before any live swap',async()=>{
    const validate=vi.fn<() => Promise<void>>(async()=>{throw Error('Parts overlap.');});
    const {controller,bridge,states}=setup(validate);await controller.newWorkspace('Assembly');
    const original=controller.geometryProjection;
    await expect(controller.mutate('update_instance',{instance:{id:'instance-1',name:'Collision'}})).rejects.toThrow(/overlap/);
    expect(controller.geometryProjection).toBe(original);expect([...states.keys()]).toEqual([descriptor.handle]);
    expect(controller.canUndoRecipe).toBe(false);
    validate.mockImplementation(async()=>undefined);
    await controller.editAtomically('update_instance',{instance:{id:'instance-1',name:'Clear'}},'1');
    expect(validate).toHaveBeenCalledTimes(2);expect(controller.geometryProjection?.instances[0].name).toBe('Clear');
    expect(bridge.mutate).not.toHaveBeenCalledWith(expect.anything(),expect.objectContaining({handle:descriptor.handle}),expect.anything());
    expect(controller.canUndoRecipe).toBe(true);controller.dispose();
  });
  it('refuses stale revisions before allocating an isolated workspace',async()=>{
    const {controller,bridge}=setup();await controller.newWorkspace('Assembly');
    await expect(controller.editAtomically('remove_instance',{instance_id:'instance-1'},'old')).rejects.toThrow(/revision/);
    expect(bridge.openWorkspace).not.toHaveBeenCalled();controller.dispose();
  });
  it.each(['cancel','readonly','context','refresh','invalid-solve'] as const)('keeps live state and history after %s during an isolated edit',async(mode)=>{
    const {controller,bridge,states,lock}=setup();await controller.newWorkspace('Assembly');
    let finish!:()=>void,context=true;
    const original=vi.mocked(bridge.mutate).getMockImplementation()!;
    vi.mocked(bridge.mutate).mockImplementation(async(...args)=>{const result=await original(...args);await new Promise<void>(resolve=>{finish=resolve;});return mode==='invalid-solve'?{...result,solution:{...result.solution,status:'invalid'}}:result;});
    const abort=new AbortController(),guard=()=>{if(!context)throw Error('Context changed');};
    const pending=controller.editAtomically('update_instance',{instance:{name:'Candidate'}},'1',abort.signal,guard);
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    expect(states.get(descriptor.handle)?.name).toBe('Bracket:1');
    await expect(controller.mutate('remove_instance',{instance_id:'instance-1'})).rejects.toThrow(/already rebuilding/);
    if(mode==='cancel')abort.abort();if(mode==='readonly')lock();if(mode==='context')context=false;if(mode==='refresh')await controller.refresh();
    const before=controller.geometryProjection;finish();await expect(pending).rejects.toThrow();
    expect(controller.geometryProjection).toBe(before);expect(controller.geometryProjection?.instances[0].name).toBe('Bracket:1');
    expect(controller.canUndoRecipe).toBe(false);expect([...states.keys()]).toEqual([descriptor.handle]);controller.dispose();
  });
});
