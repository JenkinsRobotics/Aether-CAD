import { scopeAssemblyProjection } from "./assembly/projection-scope";
/** Turn the open assembly document into a job the assembly solver can run.
 *
 *  The projection speaks metres and connector frames; the engine speaks
 *  millimetres and joint coordinate systems. This is where those meet — a
 *  pure function, so what gets sent to the solver is testable without a host,
 *  an engine, or a document open.
 */
import { Quaternion } from "three";
import { connectorMatrix } from "./math";
import type {
  AssemblyJob,
  AssemblyJoint,
  AssemblyJointEnd,
  AssemblyMateKind,
  AssemblyPartDefinition,
} from "./assembly-types";
import type {
  AssemblyProjectionV1,
  ConnectorFrameProjection,
} from "./cad-assembly-bridge";
import type { PartDocument } from "./aether-core";

/** The projection is in metres because it is shared with the animation
 *  engine's rig semantics; every length the CAD engine takes is millimetres. */
const METRES_TO_MM = 1000;

/** Right-handed cross product. The contract asks for all three axes even
 *  though the transform re-derives Y; give it the real one rather than a
 *  placeholder that would be wrong if it were ever used. */
const cross = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export interface AssemblyJobTranslation {
  job: AssemblyJob;
  /** What could not be sent, and why, in the same shape the feature
   *  translator reports — a half-sent assembly must never look complete. */
  untranslated: { id: string; name: string; reason: string }[];
  complete: boolean;
}

/** The axis a workspace DOF name implies: `translation_x` → x; plain rotation/travel → z, except pin-slot travel → x. */
const dofAxis = (name: string, kind: string): "x" | "y" | "z" => (name.endsWith("_x") || (kind === "pin_slot" && name === "translation") ? "x" : name.endsWith("_y") ? "y" : "z");

/** A connector frame as a placement the engine can use directly. */
function connectorPlacement(frame: ConnectorFrameProjection): {
  placement_mm: [number, number, number];
  rotation: [number, number, number, number];
} {
  const origin: [number, number, number] = [
    frame.origin_m[0] * METRES_TO_MM,
    frame.origin_m[1] * METRES_TO_MM,
    frame.origin_m[2] * METRES_TO_MM,
  ];
  // The projection calls them primary/secondary; the connector contract calls
  // them z/x. Same two axes: primary is the connector's normal.
  const zAxis = [...frame.primary_axis_xyz] as [number, number, number];
  const xAxis = [...frame.secondary_axis_xyz] as [number, number, number];
  const matrix = connectorMatrix({ origin, zAxis, xAxis, yAxis: cross(zAxis, xAxis) });
  const rotation = new Quaternion().setFromRotationMatrix(matrix);
  return {
    placement_mm: origin,
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

export function assemblyJobFor(projection: AssemblyProjectionV1): AssemblyJobTranslation {
  projection = scopeAssemblyProjection(projection);
  const untranslated: AssemblyJobTranslation["untranslated"] = [];
  const note = (id: string, name: string, reason: string) =>
    untranslated.push({ id, name, reason });

  // Parts, built from the feature document the projection carries. A part
  // without one cannot be placed, and every instance of it is lost with it.
  const parts: AssemblyPartDefinition[] = [];
  const buildable = new Set<string>();
  const usedParts = new Set(projection.instances.filter(instance => !instance.suppressed && instance.definition_kind === "part").map(instance => instance.definition_id));
  for (const definition of projection.part_definitions) {
    // A Hybrid also holds unfinished Parts that are not in this Assembly.
    if (!usedParts.has(definition.id)) continue;
    const document = definition.feature_document as PartDocument | undefined;
    if (!document) {
      note(definition.id, definition.name, "the part carries no feature document");
      continue;
    }
    if (!document.features.length) {
      note(definition.id, definition.name, "the part has no features");
      continue;
    }
    parts.push({ id: definition.id });
    buildable.add(definition.id);
  }

  const connectors = new Map(
    projection.connector_definitions.map((connector) => [connector.id, connector]),
  );

  const instanceDefinitions = new Map(projection.instances.map(instance => [instance.id, instance.definition_id]));
  const placed = new Set<string>();
  const instances = projection.instances.flatMap((instance) => {
    // A suppressed instance is deliberately not in the assembly; a
    // sub-assembly instance is not a part and has nothing to build.
    if (instance.suppressed) return [];
    if (instance.definition_kind !== "part") {
      note(instance.id, instance.name, "sub-assemblies are not solved yet");
      return [];
    }
    if (!buildable.has(instance.definition_id)) {
      note(instance.id, instance.name, "its part did not translate");
      return [];
    }
    placed.add(instance.id);
    // Canonical tree poses are an initial guess, never new authored placement.
    // Use the same guess in the viewport, contact checks and saved worker so a
    // floating group cannot settle into a different arbitrary rigid transform.
    // Constraints below still validate every coordinate and relation.
    const pose = instance.grounded ? instance.rest_transform : instance.solved_world_transform ?? instance.rest_transform;
    return [{
      id: instance.id,
      part: instance.definition_id,
      placement_mm: [
        pose.position_m[0] * METRES_TO_MM,
        pose.position_m[1] * METRES_TO_MM,
        pose.position_m[2] * METRES_TO_MM,
      ] as [number, number, number],
      rotation: [...pose.rotation_quaternion_xyzw] as [number, number, number, number],
      grounded: instance.grounded,
    }];
  });

  const joints = projection.mates.flatMap((mate): AssemblyJoint[] => {
    if (mate.suppressed) return [];
    const end = (endpoint: { instance_id: string; connector_definition_id: string }):
      AssemblyJointEnd | null => {
      if (!placed.has(endpoint.instance_id)) return null;
      const connector = connectors.get(endpoint.connector_definition_id);
      if (!connector || connector.suppressed) {
        note(mate.id, mate.name, `Connector ${endpoint.connector_definition_id} is ${connector ? "suppressed" : "missing"}. Restore it or select a new connector.`);
        return null;
      }
      if (connector.part_definition_id !== instanceDefinitions.get(endpoint.instance_id)) {
        note(mate.id, mate.name, "The connector belongs to a different part definition. Select a connector on this component.");
        return null;
      }
      const frame = connector.frame_part_local;
      const finite = (vector: readonly number[]) => vector.length === 3 && vector.every(Number.isFinite);
      const length = (vector: readonly number[]) => Math.hypot(...vector);
      if (!finite(frame.origin_m) || !finite(frame.primary_axis_xyz) || !finite(frame.secondary_axis_xyz)
          || length(frame.primary_axis_xyz) < 1e-9 || length(frame.secondary_axis_xyz) < 1e-9
          || length(cross(frame.primary_axis_xyz, frame.secondary_axis_xyz)) / (length(frame.primary_axis_xyz) * length(frame.secondary_axis_xyz)) < 1e-6) {
        note(mate.id, mate.name, "The connector frame is invalid. Repair its origin and axes before solving.");
        return null;
      }
      return { instance: endpoint.instance_id, ...connectorPlacement(frame) };
    };
    const a = end(mate.endpoint_a);
    const b = end(mate.endpoint_b);
    if (!a || !b) {
      if (!placed.has(mate.endpoint_a.instance_id) || !placed.has(mate.endpoint_b.instance_id))
        note(mate.id, mate.name, "it mates an instance that is not in the assembly");
      return [];
    }
    // A "free" workspace DOF is editable, not valueless: keep its authored pose
    // in the geometry solve. Dependent DOFs are evaluated through their relation.
    const dofs = (mate.dofs ?? []).filter((dof) => (dof.state === "driven" || dof.state === "free") && (dof.kind === "rotation" ? dof.value_rad : dof.value_m) !== null).map((dof) => ({
      name: dof.name, kind: dof.kind, axis: dofAxis(dof.name, mate.type_id),
      value: (mate.type_id === "pin_slot" ? -1 : 1) * (dof.kind === "rotation" ? (dof.value_rad as number) * 180 / Math.PI : (dof.value_m as number) * METRES_TO_MM),
    }));
    // Workspace pin-slot motion is B = A · Rz(angle) · Tx(travel). The
    // solver's slot belongs to its first endpoint: A = B · Tx(-travel) ·
    // Rz(-angle). Reverse endpoints and both coordinates, preserving saved intent.
    const endpoints = mate.type_id === "pin_slot" ? { a: b, b: a } : { a, b };
    return [{ id: mate.id, kind: mate.type_id as AssemblyMateKind, ...endpoints, ...(dofs.length ? { parameters: { dofs } } : {}) }];
  });
  // Relations couple two mates' DOFs: the projection names DOF ids; the solver wants the mate and the DOF's name.
  const dofOwner = new Map<string, { joint: string; dof: string; kind: "rotation" | "translation"; sign: number }>();
  for (const mate of projection.mates) for (const dof of mate.dofs ?? []) dofOwner.set(dof.id, { joint: mate.id, dof: dof.name, kind: dof.kind, sign: mate.type_id === "pin_slot" ? -1 : 1 });
  const solvedJoints = new Set(joints.map((joint) => joint.id));
  const relations = (projection.relations ?? []).flatMap((relation) => {
    if (relation.suppressed) return [];
    const driver = dofOwner.get(relation.driver_dof_id), driven = dofOwner.get(relation.driven_dof_id);
    if (!driver || !driven || !solvedJoints.has(driver.joint) || !solvedJoints.has(driven.joint)) { note(relation.id, relation.kind, "it couples a mate that is not solved"); return []; }
    const kind = relation.kind as "gear" | "rack_pinion" | "screw" | "linear";
    if (!["gear", "rack_pinion", "screw", "linear"].includes(kind)) { note(relation.id, relation.kind, `relation kind '${relation.kind}' is not solved`); return []; }
    // Workspace ratios already include reversal; applying its display flag again
    // would reverse twice. Convert signed SI coordinates into solver coordinates.
    const unit = (k: "rotation" | "translation") => (k === "rotation" ? 180 / Math.PI : METRES_TO_MM);
    const ratio = relation.ratio * unit(driven.kind) / unit(driver.kind) * driven.sign / driver.sign;
    const offset = driven.sign * (driven.kind === "rotation" ? (relation.offset_rad ?? 0) * 180 / Math.PI : (relation.offset_m ?? 0) * METRES_TO_MM);
    return [{ id: relation.id, kind, driver: { joint: driver.joint, dof: driver.dof }, driven: { joint: driven.joint, dof: driven.dof }, ratio, offset, reversed: false }];
  });

  return {
    job: { parts, instances, joints, ...(relations.length ? { relations } : {}) },
    untranslated,
    complete: untranslated.length === 0,
  };
}
