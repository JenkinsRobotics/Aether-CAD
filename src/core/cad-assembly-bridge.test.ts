import { describe, expect, it, vi } from "vitest";
import {
  AssemblyBridgeClient,
  AssemblyBridgeError,
  AssemblyProjectionDecodeError,
  decodeAssemblyMutationResult,
  decodeAssemblyMatePreview,
  decodeAssemblyProjection,
  decodeAssemblyWorkspaceDescriptor,
} from "./cad-assembly-bridge";

const transform = {
  position_m: [0, 0, 0],
  rotation_quaternion_xyzw: [0, 0, 0, 1],
};

const assembly = {
  schema_version: 1,
  workspace_id: "workspace-1",
  revision: "revision-7",
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
    unavailable_reasons: [
      { capability_id: "can_solve_loops", reason: "Loop solving is not available." },
    ],
  },
  assemblies: [
    { id: "assembly-1", name: "Drive", description: null, root_instance_ids: ["instance-1"] },
  ],
  part_definitions: [
    {
      id: "part-1",
      name: "Bracket",
      part_number: "BR-100",
      description: null,
      material_id: null,
      mass_kg: 0.12,
      source: { kind: "authored", label: "Bracket", asset_ref: null, status: "resolved" },
      custom_properties: [{ key: "finish", value: "matte" }],
    },
  ],
  instances: [
    {
      id: "instance-1",
      parent_assembly_id: "assembly-1",
      definition_kind: "part",
      definition_id: "part-1",
      name: "Bracket:1",
      parent_instance_id: null,
      rest_transform: transform,
      solved_world_transform: transform,
      grounded: true,
      suppressed: false,
      visible: true,
      source_status: "resolved",
    },
  ],
  connector_definitions: [
    {
      id: "connector-1",
      part_definition_id: "part-1",
      name: "Mount",
      frame_part_local: {
        origin_m: [0, 0, 0],
        primary_axis_xyz: [0, 0, 1],
        secondary_axis_xyz: [1, 0, 0],
      },
      provenance: { kind: "face", stable_feature_id: "face-stable-1", label: "Top face" },
      suppressed: false,
    },
  ],
  mates: [
    {
      id: "mate-1",
      name: "Fastened 1",
      type_id: "fastened",
      endpoint_a: { instance_id: "instance-1", connector_definition_id: "connector-1" },
      endpoint_b: { instance_id: "instance-2", connector_definition_id: "connector-2" },
      dofs: [],
      controls: [{ key: "flip_primary_axis", value: false }],
      suppressed: false,
      solve_state: "satisfied",
      diagnostic_ids: [],
    },
  ],
  relations: [],
  configurations: [
    { id: "configuration-1", name: "Default", active: true, suppressed_instance_ids: [], overridden_dof_ids: [] },
  ],
  issues: [],
};

const solution = {
  status: "solved",
  revision: "revision-7",
  instance_world_transforms: [{ instance_id: "instance-1", transform }],
  dof_values: [],
  remaining_free_dof_count: 0,
  residual: 0,
  iterations: 0,
  limit_violations: [],
  diagnostic_ids: [],
};

const bom = {
  schema_version: 1,
  assembly_id: "assembly-1",
  revision: "revision-7",
  mode: "hierarchical",
  rows: [
    {
      row_id: "row-1",
      parent_row_id: null,
      part_definition_id: "part-1",
      quantity: 1,
      part_number: "BR-100",
      name: "Bracket",
      description: null,
      material_name: null,
      unit_mass_kg: 0.12,
      extended_mass_kg: 0.12,
      source_label: "Bracket",
      custom_properties: [],
    },
  ],
  total_mass_kg: 0.12,
  diagnostic_ids: [],
};

describe("assembly projection decoder", () => {
  it("decodes the canonical workspace handle and root Assembly", () => {
    expect(decodeAssemblyWorkspaceDescriptor({
      schema_version: 1,
      handle: "handle-1",
      workspace_id: "workspace-1",
      name: "Drive",
      revision: "7",
      graph_sha256: "abc",
      root_assembly_id: "assembly-1",
      assembly_ids: ["assembly-1"],
    })).toMatchObject({ handle: "handle-1", root_assembly_id: "assembly-1" });
  });

  it("accepts the frozen explicit-unit projection", () => {
    const decoded = decodeAssemblyProjection(assembly);
    expect(decoded.workspace_id).toBe("workspace-1");
    expect(decoded.instances[0].solved_world_transform.rotation_quaternion_xyzw).toEqual([0, 0, 0, 1]);
    expect(decoded.connector_definitions[0].frame_part_local.primary_axis_xyz).toEqual([0, 0, 1]);
  });

  it("rejects unknown required schema versions before publishing state", () => {
    expect(() => decodeAssemblyProjection({ ...assembly, schema_version: 2 })).toThrowError(
      new AssemblyProjectionDecodeError("assembly.schema_version", "unsupported schema version"),
    );
  });

  it("reports the exact path of a malformed transform", () => {
    const malformed = structuredClone(assembly);
    malformed.instances[0].solved_world_transform = {
      ...malformed.instances[0].solved_world_transform,
      rotation_quaternion_xyzw: [0, 1, 0],
    };
    expect(() => decodeAssemblyProjection(malformed)).toThrow(
      "assembly.instances[0].solved_world_transform.rotation_quaternion_xyzw: expected 4 numbers",
    );
  });

  it("rejects a mutation refresh whose revisions disagree", () => {
    expect(() => decodeAssemblyMutationResult({
      handle: "workspace-1",
      revision: "revision-8",
      assembly,
      solution,
      bom,
    })).toThrow("result.assembly.revision: must match result.revision");
  });

  it("decodes a revision-coherent non-mutating mate preview", () => {
    expect(decodeAssemblyMatePreview({
      revision: "revision-7",
      solution,
      diagnostics: [],
    })).toMatchObject({
      revision: "revision-7",
      solution: { status: "solved", remaining_free_dof_count: 0 },
      diagnostics: [],
    });
    expect(() => decodeAssemblyMatePreview({
      revision: "revision-8",
      solution,
      diagnostics: [],
    })).toThrow("preview.solution.revision: must match preview.revision");
  });
});

describe("AssemblyBridgeClient portable CAD transport", () => {
  const descriptor = { schema_version: 1, handle: "cad-1", workspace_id: "workspace-1",
    name: "Drive", revision: "revision-7", graph_sha256: "abc",
    root_assembly_id: "assembly-1", assembly_ids: ["assembly-1"] };
  const archive = { handle: "cad-1", revision: "revision-7", graph_sha256: "abc", data_base64: "UEs=" };
  const open = { ok: true, result: descriptor, archive };
  const mutation = { ok: true, result: { handle: "cad-1", revision: "revision-8",
    assembly: { ...assembly, revision: "revision-8" }, solution: { ...solution, revision: "revision-8" },
    bom: { ...bom, revision: "revision-8" } }, archive: { ...archive, revision: "revision-8", data_base64: "bmV3" } };
  function setup(replies: unknown[]) {
    let id = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(replies.shift()), { status: 200 }));
    return { fetch, client: new AssemblyBridgeClient({ baseURL: "http://cad/", fetch, nextRequestID: () => ++id }) };
  }
  it("uses the authorized CAD service with immutable bytes; save and release stay local", async () => {
    const { client, fetch } = setup([open, { ok: true, result: assembly }]);
    await client.openWorkspace("b2xk");
    const signal = new AbortController().signal;
    await client.describeAssembly("cad-1", "assembly-1", signal);
    expect(fetch.mock.calls[1][0]).toBe("http://cad/api/cad/assembly");
    expect(fetch.mock.calls[1][1]?.signal).toBe(signal);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ operation: "workspace",
      method: "describe_assembly", params: { handle: "cad-1", assembly_id: "assembly-1" }, data_base64: "UEs=" });
    expect(await client.saveWorkspace("cad-1", "revision-7")).toEqual(archive);
    await client.release("cad-1");
    await expect(client.saveWorkspace("cad-1", "revision-7")).rejects.toMatchObject({ code: "unknown_handle" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses independent handles when opening the same archive twice", async () => {
    const { client } = setup([open, { ...open, result: { ...descriptor, handle: "cad-2" }, archive: { ...archive, handle: "cad-2" } }]);
    await client.openWorkspace("same"); await client.openWorkspace("same");
    await client.release("cad-1");
    expect((await client.saveWorkspace("cad-2", "revision-7")).handle).toBe("cad-2");
  });
  it("accepts validated mutation bytes and rejects a stale local revision before sending", async () => {
    const { client, fetch } = setup([open, mutation]);
    await client.openWorkspace("old");
    await client.mutate("set_contacts_enabled", { handle: "cad-1", expected_revision: "revision-7", enabled: true });
    expect((await client.saveWorkspace("cad-1", "revision-8")).data_base64).toBe("bmV3");
    await expect(client.mutate("set_contacts_enabled", { handle: "cad-1", expected_revision: "revision-7", enabled: false })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps typed domain errors and original bytes on failed mutation", async () => {
    const { client } = setup([open, { ok: false, error: { code: "unknown_entity", message: "Unknown mate", path: "mate_id" } }]);
    await client.openWorkspace("old");
    await expect(client.mutate("remove_mate", { handle: "cad-1", expected_revision: "revision-7", mate_id: "missing" }))
      .rejects.toMatchObject({ code: "unknown_entity", path: "mate_id" });
    expect(await client.saveWorkspace("cad-1", "revision-7")).toEqual(archive);
  });
  it("refuses mismatched or malformed mutation projections before replacing bytes", async () => {
    const { client } = setup([open, { ...mutation, archive: { ...mutation.archive, revision: "wrong" } },
      { ...mutation, result: { ...mutation.result, solution: { ...solution, revision: "wrong" } } }]);
    await client.openWorkspace("old");
    for (let i = 0; i < 2; i++) {
      await expect(client.mutate("remove_mate", { handle: "cad-1", expected_revision: "revision-7" })).rejects.toBeInstanceOf(AssemblyProjectionDecodeError);
      expect(await client.saveWorkspace("cad-1", "revision-7")).toEqual(archive);
    }
  });
  it("never commits a reply after cancellation even if fetch ignores abort", async () => {
    const { client, fetch } = setup([open]);
    await client.openWorkspace("old");
    const abort = new AbortController();
    fetch.mockImplementationOnce(async () => { abort.abort(); return new Response(JSON.stringify(mutation)); });
    await expect(client.mutate("set_contacts_enabled", { handle: "cad-1", expected_revision: "revision-7", enabled: true }, abort.signal)).rejects.toThrow();
    expect(await client.saveWorkspace("cad-1", "revision-7")).toEqual(archive);
  });
  it("never resurrects a released handle or overwrites a concurrent edit", async () => {
    for (const release of [true, false]) {
      const { client, fetch } = setup([open]); await client.openWorkspace("old");
      let finish!: (response: Response) => void;
      fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const pending = client.mutate("set_contacts_enabled", { handle: "cad-1", expected_revision: "revision-7", enabled: true });
      if (release) await client.release("cad-1");
      else {
        fetch.mockImplementationOnce(async () => new Response(JSON.stringify(mutation)));
        await client.mutate("set_contacts_enabled", { handle: "cad-1", expected_revision: "revision-7", enabled: false });
      }
      finish(new Response(JSON.stringify(mutation)));
      await expect(pending).rejects.toBeInstanceOf(AssemblyBridgeError);
      if (!release) expect((await client.saveWorkspace("cad-1", "revision-8")).data_base64).toBe("bmV3");
    }
  });
  it("previews without changing bytes", async () => {
    const { client, fetch } = setup([open, { ok: true, result: { revision: "revision-7", solution, diagnostics: [] } }]);
    await client.openWorkspace("old");
    await client.previewMate("cad-1", "assembly-1", { type_id: "fastened" });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).method).toBe("preview_mate");
    expect(await client.saveWorkspace("cad-1", "revision-7")).toEqual(archive);
  });
});
