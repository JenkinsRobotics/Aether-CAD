/** The browser's client for FreeCAD-solved assemblies.
 *
 *  Mates are solved by FreeCAD's Assembly workbench — the Ondsel multibody
 *  solver — headless on the host, behind the same JSON boundary the geometry
 *  path uses. Aether keeps its own mate vocabulary (`fastened`, `prismatic`);
 *  the engine translates, so saved assemblies never carry FreeCAD's names.
 *
 *  See Aether CAD/freecad-engine/README.md and dev/docs/roadmap/Mates_Engine_Decision.md.
 */
import type { FreeCADDiagnostic, FreeCADFeature } from "./freecad-geometry";

/** A part an assembly can place, as the features that build it. */
export interface AssemblyPartDefinition {
  id: string;
  features: FreeCADFeature[];
}

export interface AssemblyInstance {
  id: string;
  part: string;
  /** Starting pose. The solver moves anything not grounded. */
  placement_mm?: readonly [number, number, number];
  /** Quaternion, x/y/z/w. */
  rotation?: readonly [number, number, number, number];
  grounded?: boolean;
}

/** One side of a mate: an instance, and optionally what on it.
 *  An empty element means the instance's own placement. */
export interface AssemblyJointEnd {
  instance: string;
  element?: string;
  /** The mate connector's frame on this part. A connector is a joint
   *  coordinate system, so the engine uses this verbatim rather than deriving
   *  a frame from geometry. Absent means the instance's own placement. */
  placement_mm?: readonly [number, number, number];
  rotation?: readonly [number, number, number, number];
}

/** Aether's mate vocabulary. The engine maps these onto FreeCAD's joints;
 *  `/api/cad/mate-kinds` is the authority on which are live. */
export type AssemblyMateKind =
  | "fastened" | "revolute" | "cylindrical" | "prismatic" | "ball"
  | "distance" | "parallel" | "perpendicular" | "angle"
  | "rack-pinion" | "screw" | "gears" | "belt";

export interface AssemblyJoint {
  id: string;
  kind: AssemblyMateKind;
  a: AssemblyJointEnd;
  b: AssemblyJointEnd;
  parameters?: Record<string, unknown>;
}

export interface AssemblyJob {
  parts: AssemblyPartDefinition[];
  instances: AssemblyInstance[];
  joints: AssemblyJoint[];
}

export interface SolvedInstance {
  id: string;
  placement_mm: [number, number, number];
  rotation: [number, number, number, number];
}

export interface AssemblySolution {
  status: "ok" | "error";
  engine: string;
  message: string;
  solve_seconds: number;
  instances: SolvedInstance[];
  diagnostics: FreeCADDiagnostic[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `The host answered ${response.status}.`;
    try {
      const failure = await response.json();
      if (failure?.error) message = failure.error;
    } catch {
      // A non-JSON body carries nothing better than the status.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

/** Solve an assembly. Stateless: the job carries its own part definitions,
 *  so the same job always solves to the same placements. */
export function solveAssembly(job: AssemblyJob): Promise<AssemblySolution> {
  return post<AssemblySolution>("/api/cad/assembly", job);
}

/** Which mates the engine can actually solve.
 *
 *  Asked rather than assumed: a mate offered in the UI that the solver
 *  refuses would be discovered only after the user had authored it.
 */
export async function assemblyMateKinds(): Promise<readonly AssemblyMateKind[]> {
  const answer = await post<{ ok: boolean; kinds: AssemblyMateKind[] }>(
    "/api/cad/mate-kinds",
    {},
  );
  return answer.kinds ?? [];
}
