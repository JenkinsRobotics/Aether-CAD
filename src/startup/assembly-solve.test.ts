import { describe, expect, it, vi } from "vitest";
import { bodiesForPlacements, describeSolve, solveAssemblyProjection } from "./assembly-solve";
import { AssemblyGeometryCache } from '../assembly/geometry-cache';
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
    parts: [{ id: "b1", name: "Body 1", vertices: new Float32Array(9), normals: new Float32Array(9),
      triangles: new Uint32Array([0,1,2]), edgeLines: new Float32Array(6), topology: [], faceRanges: [] }],
  } as never)),
  parseDocument: (source: string) => parsePartDocument(source),
  ...over,
});

describe("solving the open assembly with FreeCAD", () => {
  it("places each body where the solver put it, not where it started", () => {
    return solveAssemblyProjection(projection(), deps()).then((result) => {
      expect(result.bodies).toHaveLength(2);
      // i2 started at 120mm and the solver moved it to 40mm. Taking the rest
      // transform instead would render it at 120 and look like it had solved.
      expect(result.bodies[1].positionMillimeters).toEqual([40, 0, 0]);
    });
  });

  it("names each body by its instance so two of the same part are telling apart", async () => {
    const result = await solveAssemblyProjection(projection(), deps());
    expect(result.bodies.map((b) => b.data.id)).toEqual(["assembly:i1:b1", "assembly:i2:b1"]);
    expect(result.bodies[0].data.name).toBe("Base · Body 1");
  });

  it("builds each distinct part once, through the same evaluator a Part uses", async () => {
    const dependencies = deps();
    await solveAssemblyProjection(projection(), dependencies);
    expect(dependencies.evaluate).toHaveBeenCalledTimes(1);
    expect(dependencies.solve).toHaveBeenCalledTimes(1);
  });

  it('keeps 1000 occurrence identities while sharing geometry and invalidating only changed definitions', async () => {
    const dependencies = deps(), cache = new AssemblyGeometryCache(dependencies);
    const base = projection() as unknown as import('../cad-assembly-bridge').AssemblyProjectionV1;
    const source = { ...base, instances: Array.from({length:1000}, (_, i) => ({...base.instances[0], id:`i${i}`, name:`Part ${i}`})) };
    const placements = source.instances.map((instance,i) => ({id:instance.id,placement_mm:[i,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number]}));
    const dependenciesWithCache = {...dependencies,geometryCache:cache};
    const first = await bodiesForPlacements(source, placements, dependenciesWithCache);
    expect(first).toHaveLength(1000);
    expect(new Set(first.map(body=>body.data.id)).size).toBe(1000);
    expect(new Set(first.map(body=>body.data.vertices)).size).toBe(1);
    const moved = await bodiesForPlacements(structuredClone(source), placements.map(p=>({...p,placement_mm:[p.placement_mm[0],10,0]})), dependenciesWithCache);
    expect(moved[999].positionMillimeters).toEqual([999,10,0]);
    expect(moved[999].data.vertices).toBe(first[0].data.vertices);
    expect(dependencies.evaluate).toHaveBeenCalledTimes(1);
    const edit = structuredClone(source);
    (edit.part_definitions[0].feature_document as any).features[1].distanceMillimeters = 45;
    const changed = await bodiesForPlacements(edit, placements, dependenciesWithCache);
    expect(dependencies.evaluate).toHaveBeenCalledTimes(2);
    expect(changed[0].data.vertices).not.toBe(first[0].data.vertices);
    const undone = await bodiesForPlacements(source, placements, dependenciesWithCache);
    expect(dependencies.evaluate).toHaveBeenCalledTimes(3);
    expect(undone[0].data.id).toBe(first[0].data.id);
  });

  it('stops obsolete preparations before another definition is submitted', async () => {
    const dependencies = deps();
    await bodiesForPlacements(projection(), [], {...dependencies, isCurrent: () => false});
    expect(dependencies.evaluate).not.toHaveBeenCalled();
  });

  it("rejects a partial solution before evaluating or publishing any geometry", async () => {
    const dependencies = deps({
      solve: vi.fn(async () => ({
        status: "ok" as const, engine: "FreeCAD", message: "", solve_seconds: 0.1,
        instances: [{ id: "i1", placement_mm: [0, 0, 0], rotation: [0, 0, 0, 1] }],
        diagnostics: [],
      })),
    });
    await expect(solveAssemblyProjection(projection(), dependencies)).rejects.toThrow(/incomplete/);
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
    await expect(solveAssemblyProjection(projection(), dependencies)).rejects.toThrow();
    expect(dependencies.evaluate).not.toHaveBeenCalled();
  });

  it("refuses to solve a translation that silently omitted a subassembly", async () => {
    const source = projection() as unknown as {instances: Record<string, unknown>[]};
    const dependencies = deps();
    const incomplete = projection({instances: [...source.instances, {
      id: "nested", definition_kind: "assembly", definition_id: "a1", name: "Gearbox", suppressed: false,
    }]});
    await expect(solveAssemblyProjection(incomplete, dependencies)).rejects.toThrow(/Gearbox.*sub-assemblies/);
    expect(dependencies.solve).not.toHaveBeenCalled();
    expect(dependencies.evaluate).not.toHaveBeenCalled();
  });

  it("refuses an assembly with nothing to place, rather than solving nothing", async () => {
    await expect(
      solveAssemblyProjection(projection({ instances: [] }), deps()),
    ).rejects.toThrow(/no part instance/);
  });

  it("skips a hidden or suppressed instance", async () => {
    const hidden = projection() as never as Record<string, never>;
    const result = await solveAssemblyProjection({
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

it('preserves saved appearances for every occurrence through a cached solve', async () => {
 const base = projection() as unknown as import('../cad-assembly-bridge').AssemblyProjectionV1;
 const doc = document();doc.bodyProperties={b1:{name:'Body',visible:true,appearance:{color:'#aa2244',metalness:.8},material:{name:'Aluminum',densityKgPerM3:2700}}};
 const source={...base,part_definitions:[{...base.part_definitions[0],feature_document:JSON.parse(serializePartDocument(doc))}]};
 const dependencies=deps();const cache=new AssemblyGeometryCache(dependencies);
 const first=await solveAssemblyProjection(source,{...dependencies,geometryCache:cache});
 expect(first.bodies.map(b=>b.appearance)).toEqual([{color:'#aa2244',metalness:.8},{color:'#aa2244',metalness:.8}]);
 const second=await solveAssemblyProjection(source,{...dependencies,geometryCache:cache});
 expect(second.bodies[1].appearance).toEqual(first.bodies[1].appearance);
 expect(dependencies.evaluate).toHaveBeenCalledTimes(1);
});
