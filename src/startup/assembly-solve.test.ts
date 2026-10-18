import { describe, expect, it, vi } from "vitest";
import { describeSolve, solveAssemblyWithFreeCAD } from "./assembly-solve";
import { createRectanglePartDocument, serializePartDocument, parsePartDocument } from "../aether-core";

const document = () => createRectanglePartDocument("Bracket", {
  widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
});

const projection = (over: Record<string, unknown> = {}) => ({
  part_definitions: [{ id: "p1", name: "Bracket", feature_document: JSON.parse(serializePartDocument(document())) }],
  connector_definitions: [],
  instances: [
    { id: "i1", definition_kind: "part", definition_id: "p1", name: "Base",
      rest_transform: { position_m: [0, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
      grounded: true, suppressed: false, visible: true },
    { id: "i2", definition_kind: "part", definition_id: "p1", name: "Block",
      rest_transform: { position_m: [0.12, 0, 0], rotation_quaternion_xyzw: [0, 0, 0, 1] },
      grounded: false, suppressed: false, visible: true },
  ],
  mates: [],
  ...over,
}) as never;

const deps = (over: Record<string, unknown> = {}) => ({
  // The solver answers in millimetres already, unlike the projection.
  solve: vi.fn(async () => ({
    status: "ok" as const, engine: "FreeCAD 1.1.3", message: "", solve_seconds: 0.25,
    instances: [
      { id: "i1", placement_mm: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
      { id: "i2", placement_mm: [40, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
    ],
    diagnostics: [],
  })),
  evaluate: vi.fn(async () => ({
    sourceName: "Bracket", parseMilliseconds: 1,
    parts: [{ id: "b1", name: "Body 1" }],
  } as never)),
  parseDocument: (source: string) => parsePartDocument(source),
  ...over,
});

describe("solving the open assembly with FreeCAD", () => {
  it("places each body where the solver put it, not where it started", () => {
    return solveAssemblyWithFreeCAD(projection(), deps()).then((result) => {
      expect(result.bodies).toHaveLength(2);
      // i2 started at 120mm and the solver moved it to 40mm. Taking the rest
      // transform instead would render it at 120 and look like it had solved.
      expect(result.bodies[1].positionMillimeters).toEqual([40, 0, 0]);
    });
  });

  it("names each body by its instance so two of the same part are telling apart", async () => {
    const result = await solveAssemblyWithFreeCAD(projection(), deps());
    expect(result.bodies.map((b) => b.data.id)).toEqual(["assembly:i1:b1", "assembly:i2:b1"]);
    expect(result.bodies[0].data.name).toBe("Base · Body 1");
  });

  it("builds the part once per instance, through the same evaluator a Part uses", async () => {
    const dependencies = deps();
    await solveAssemblyWithFreeCAD(projection(), dependencies);
    expect(dependencies.evaluate).toHaveBeenCalledTimes(2);
    expect(dependencies.solve).toHaveBeenCalledTimes(1);
  });

  it("rejects a partial solution before evaluating or publishing any geometry", async () => {
    const dependencies = deps({
      solve: vi.fn(async () => ({
        status: "ok" as const, engine: "FreeCAD", message: "", solve_seconds: 0.1,
        instances: [{ id: "i1", placement_mm: [0, 0, 0], rotation: [0, 0, 0, 1] }],
        diagnostics: [],
      })),
    });
    await expect(solveAssemblyWithFreeCAD(projection(), dependencies)).rejects.toThrow(/incomplete/);
    expect(dependencies.evaluate).not.toHaveBeenCalled();
  });

  it.each(["error", "diagnostic", "duplicate", "non-finite", "rotation"])("rejects %s responses before touching displayed bodies", async kind => {
    const dependencies = deps();
    const result = await dependencies.solve();
    if (kind === "error") Object.assign(result, {status: "error", message: "Native solver failed"});
    if (kind === "diagnostic") Object.assign(result, {diagnostics: [{severity: "error", feature_id: "mate", message: "Invalid mate"}]});
    if (kind === "duplicate") result.instances[1].id = result.instances[0].id;
    if (kind === "non-finite") result.instances[1].placement_mm[0] = NaN;
    if (kind === "rotation") result.instances[1].rotation = [0, 0, 0, 0];
    dependencies.solve.mockResolvedValue(result);
    await expect(solveAssemblyWithFreeCAD(projection(), dependencies)).rejects.toThrow();
    expect(dependencies.evaluate).not.toHaveBeenCalled();
  });

  it("refuses to solve a translation that silently omitted a subassembly", async () => {
    const source = projection() as unknown as {instances: Record<string, unknown>[]};
    const dependencies = deps();
    const incomplete = projection({instances: [...source.instances, {
      id: "nested", definition_kind: "assembly", definition_id: "a1", name: "Gearbox", suppressed: false,
    }]});
    await expect(solveAssemblyWithFreeCAD(incomplete, dependencies)).rejects.toThrow(/Gearbox.*sub-assemblies/);
    expect(dependencies.solve).not.toHaveBeenCalled();
    expect(dependencies.evaluate).not.toHaveBeenCalled();
  });

  it("refuses an assembly with nothing to place, rather than solving nothing", async () => {
    await expect(
      solveAssemblyWithFreeCAD(projection({ instances: [] }), deps()),
    ).rejects.toThrow(/no part instance/);
  });

  it("skips a hidden or suppressed instance", async () => {
    const hidden = projection() as never as Record<string, never>;
    const result = await solveAssemblyWithFreeCAD({
      ...hidden,
      instances: (hidden.instances as unknown as Record<string, unknown>[]).map((i) =>
        i.id === "i2" ? { ...i, visible: false } : i),
    } as never, deps());
    expect(result.bodies.map((b) => b.data.id)).toEqual(["assembly:i1:b1"]);
  });
});

describe("what the status bar says about a solve", () => {
  const base = {
    bodies: [{ data: { id: "a" }, positionMillimeters: [0, 0, 0], quaternion: [0, 0, 0, 1] }],
    untranslated: [],
    solution: { status: "ok" as const, engine: "FreeCAD 1.1.3", message: "",
                solve_seconds: 0.25, instances: [], diagnostics: [] },
  } as never;

  it("names the engine, the count and the time", () => {
    expect(describeSolve(base)).toBe("FreeCAD 1.1.3 placed 1 body in 250 ms.");
  });

  it("reports a mate that failed rather than claiming success", () => {
    const withError = { ...(base as never as Record<string, unknown>) } as Record<string, unknown>;
    withError.solution = { ...(base as never as { solution: Record<string, unknown> }).solution,
      diagnostics: [{ feature_id: "m1", severity: "error", message: "no" }] };
    expect(describeSolve(withError as never)).toMatch(/1 mate failed/);
  });

  it("says when something never reached the engine", () => {
    const partial = { ...(base as never as Record<string, unknown>) } as Record<string, unknown>;
    partial.untranslated = [{ id: "p2", name: "Gear", reason: "no feature document" }];
    expect(describeSolve(partial as never)).toMatch(/1 not sent/);
  });

  it("passes the solver's own message through when it did not solve", () => {
    const failed = { ...(base as never as Record<string, unknown>) } as Record<string, unknown>;
    failed.solution = { ...(base as never as { solution: Record<string, unknown> }).solution,
      status: "error", message: "the solver did not converge" };
    expect(describeSolve(failed as never)).toBe("the solver did not converge");
  });
});
