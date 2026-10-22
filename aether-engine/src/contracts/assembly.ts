/** The assembly job and solution, the shape the FreeCAD-backed service used
 *  (`aether_freecad/protocol.py`), so the in-process solver is a drop-in. */
export type AssemblyMateKind =
  | "fastened" | "revolute" | "cylindrical" | "prismatic" | "ball"
  | "distance" | "parallel" | "perpendicular" | "angle"
  | "planar" | "pin_slot"
  | "rack-pinion" | "screw" | "gears" | "belt";

export interface AssemblyJointEnd {
  instance: string;
  element?: string;
  /** The mate connector's frame on this part: a joint coordinate system. Absent means the instance's own placement. */
  placement_mm?: readonly [number, number, number];
  /** Quaternion, x/y/z/w. */
  rotation?: readonly [number, number, number, number];
}

export interface AssemblyJoint {
  id: string;
  kind: AssemblyMateKind;
  a: AssemblyJointEnd;
  b: AssemblyJointEnd;
  parameters?: Record<string, unknown>;
}

export interface AssemblyInstance {
  id: string;
  part: string;
  placement_mm?: readonly [number, number, number];
  rotation?: readonly [number, number, number, number];
  grounded?: boolean;
}

export interface AssemblyJobInput {
  parts: { id: string; features?: unknown[] }[];
  instances: AssemblyInstance[];
  joints: AssemblyJoint[];
}

export interface AssemblyDiagnostic { feature_id: string; severity: "error" | "warning"; message: string }

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
  diagnostics: AssemblyDiagnostic[];
}
