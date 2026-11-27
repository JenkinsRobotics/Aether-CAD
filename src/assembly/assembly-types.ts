/** The assembly job and solution the in-process solver takes and answers. Aether keeps
 *  its own mate vocabulary (`fastened`, `prismatic`, …); saved assemblies carry no
 *  engine's names. */
export type {
  AssemblyInstance, AssemblyJoint, AssemblyJointEnd, AssemblyMateKind, AssemblySolution, SolvedInstance,
  AssemblyJobInput as AssemblyJob, AssemblyDiagnostic,
} from "@aether/core/contracts";

/** A part an assembly can place; the solver places rigid instances, so only its identity matters here. */
export interface AssemblyPartDefinition { id: string; features?: unknown[] }
