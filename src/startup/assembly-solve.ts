/** Solve the open assembly with the engine and hand back bodies to render.
 *
 *  The existing path takes each instance's `solved_world_transform` from the
 *  projection — aether_animation's answer. This takes the same parts and mates,
 *  solves them with the engine's assembly solver instead, and places the
 *  bodies at what that solver returned.
 *
 *  Everything it needs is injected, so the whole thing is testable without a
 *  host, an engine, or a document open.
 */
import { assemblyJobFor } from "../assembly-job";
import type { AssemblyJob, AssemblySolution } from "../assembly-types";
import type { AssemblyProjectionV1 } from "../cad-assembly-bridge";
import type { ImportedModelData } from "../domain";
import type { PartDocument } from "../aether-core";
import { AssemblyGeometryCache, type EvaluatedDefinition } from '../assembly/geometry-cache';

export interface SolvedBody {
  data: ImportedModelData["parts"][number];
  positionMillimeters: readonly number[];
  quaternion: readonly number[];
}

export interface AssemblySolveResult {
  bodies: SolvedBody[];
  solution: AssemblySolution;
  /** Parts and mates that could not be sent, with the reason. */
  untranslated: { id: string; name: string; reason: string }[];
}

export interface AssemblySolveDependencies {
  solve(job: AssemblyJob): Promise<AssemblySolution>;
  evaluate(document: PartDocument): Promise<ImportedModelData>;
  parseDocument(source: string): PartDocument;
  geometryCache?: AssemblyGeometryCache;
  /** Stop obsolete renders before submitting another kernel request. */
  isCurrent?: () => boolean;
}

export async function solveAssemblyProjection(
  projection: AssemblyProjectionV1,
  deps: AssemblySolveDependencies,
): Promise<AssemblySolveResult> {
  const { job, untranslated } = assemblyJobFor(projection);
  if (untranslated.length)
    throw new Error(`Assembly cannot be solved completely: ${untranslated.map(item => `${item.name}: ${item.reason}`).join("; ")}`);
  if (!job.instances.length)
    throw new Error("This assembly has no part instance the engine can place.");

  const solution = await deps.solve(job);
  const errors = solution.diagnostics.filter(item => item.severity === "error");
  if (solution.status !== "ok" || errors.length)
    throw new Error(solution.message || errors.map(item => item.message).join("; ") || "The assembly did not solve.");
  const placements = new Map(solution.instances.map((i) => [i.id, i]));
  if (placements.size !== solution.instances.length || placements.size !== job.instances.length
    || job.instances.some(instance => !placements.has(instance.id)))
    throw new Error("The assembly solver returned incomplete or duplicate placements. The previous geometry is unchanged.");
  if (solution.instances.some(instance => instance.placement_mm.length !== 3 || instance.rotation.length !== 4
    || [...instance.placement_mm, ...instance.rotation].some(value => !Number.isFinite(value))
    || Math.abs(Math.hypot(...instance.rotation) - 1) > 1e-6))
    throw new Error("The assembly solver returned an invalid placement. The previous geometry is unchanged.");

  const bodies = await bodiesForPlacements(projection, solution.instances, deps);
  return { bodies, solution, untranslated };
}

/** One line for the status bar: what solved, how fast, and what did not. */
export function describeSolve(result: AssemblySolveResult): string {
  const { solution, bodies, untranslated } = result;
  if (solution.status !== "ok")
    return solution.message || "The assembly did not solve.";
  const errors = solution.diagnostics.filter((d) => d.severity === "error");
  const parts = [
    `${solution.engine} placed ${bodies.length} ${bodies.length === 1 ? "body" : "bodies"}`,
    `in ${(solution.solve_seconds * 1000).toFixed(0)} ms`,
  ];
  if (errors.length) parts.push(`· ${errors.length} mate failed`);
  if (untranslated.length) parts.push(`· ${untranslated.length} not sent`);
  return parts.join(" ") + ".";
}

/** The visible bodies of every placed instance at the given placements (millimetres, quaternions). */
export async function bodiesForPlacements(projection: AssemblyProjectionV1, instances: AssemblySolution["instances"], deps: Pick<AssemblySolveDependencies, "evaluate" | "parseDocument" | "geometryCache" | "isCurrent">): Promise<SolvedBody[]> {
  const placements = new Map(instances.map((i) => [i.id, i]));
  const definitions = new Map(projection.part_definitions.map(part => [part.id, part]));
  const cache = deps.geometryCache ?? new AssemblyGeometryCache(deps);
  // Pin the current preparation's definitions even if the bounded session cache
  // evicts them. Thousands of occurrences still evaluate a definition once.
  const evaluated = new Map<string, EvaluatedDefinition>();
  const bodies: SolvedBody[] = [];
  for (const instance of projection.instances) {
    if (deps.isCurrent?.() === false) return [];
    if (instance.suppressed || !instance.visible) continue;
    const placement = placements.get(instance.id);
    if (!placement) continue;
    const definition = definitions.get(instance.definition_id);
    if (!definition?.feature_document) continue;
    let result = evaluated.get(definition.id);
    if (!result) {
      result = await cache.get(JSON.stringify([projection.workspace_id, definition.id]), JSON.stringify(definition.feature_document));
      evaluated.set(definition.id, result);
    }
    const { document, model } = result;
    for (const body of model.parts) {
      // A body the part hides stays hidden when the part is placed.
      if (document.bodyProperties?.[body.id]?.visible === false) continue;
      bodies.push({ data: { ...body, id: `assembly:${instance.id}:${body.id}`, name: `${instance.name} · ${body.name}` }, positionMillimeters: placement.placement_mm, quaternion: placement.rotation });
    }
  }
  return bodies;
}

