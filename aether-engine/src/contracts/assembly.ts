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

/** A mate's degree of freedom held at a value: a rotation about, or a travel along,
 *  one axis of the first end's frame (degrees or millimetres). */
export interface AssemblyJointValue { name: string; kind: "rotation" | "translation"; axis: "x" | "y" | "z"; value: number }
/** A coupling between two mates' degrees of freedom: driven = ratio · driver + offset
 *  (reversed negates the ratio); gears turn two rotations, rack and pinion and screw turn
 *  a rotation into a travel, linear couples two travels. */
export interface AssemblyRelation {
  id: string;
  kind: "gear" | "rack_pinion" | "screw" | "linear";
  driver: { joint: string; dof: string };
  driven: { joint: string; dof: string };
  ratio: number;
  offset?: number;
  reversed?: boolean;
}
export interface AssemblyJobInput {
  parts: { id: string; features?: unknown[] }[];
  instances: AssemblyInstance[];
  joints: AssemblyJoint[];
  relations?: AssemblyRelation[];
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
