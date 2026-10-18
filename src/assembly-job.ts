/** Turn the open assembly document into a job FreeCAD's solver can run.
 *
 *  The projection speaks metres and connector frames; the engine speaks
 *  millimetres and joint coordinate systems. This is where those meet — a
 *  pure function, so what gets sent to the solver is testable without a host,
 *  an engine, or a document open.
 */
import { Quaternion } from "three";
import { connectorMatrix } from "./math";
import { translateDocument } from "./freecad-translate";
import type {
  AssemblyJob,
  AssemblyJoint,
  AssemblyJointEnd,
  AssemblyMateKind,
  AssemblyPartDefinition,
} from "./freecad-assembly";
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
  const untranslated: AssemblyJobTranslation["untranslated"] = [];
  const note = (id: string, name: string, reason: string) =>
    untranslated.push({ id, name, reason });

  // Parts, built from the feature document the projection carries. A part
  // without one cannot be placed, and every instance of it is lost with it.
  const parts: AssemblyPartDefinition[] = [];
  const buildable = new Set<string>();
  for (const definition of projection.part_definitions) {
    const document = definition.feature_document as PartDocument | undefined;
    if (!document) {
      note(definition.id, definition.name, "the part carries no feature document");
      continue;
    }
    const translated = translateDocument(document);
    if (!translated.features.length) {
      note(definition.id, definition.name, "the part translated to no geometry");
      continue;
    }
    if (!translated.complete)
      note(definition.id, definition.name,
        `part is incomplete: ${translated.untranslated[0]?.reason ?? "unknown"}`);
    parts.push({ id: definition.id, features: translated.features });
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
    const rest = instance.rest_transform;
    return [{
      id: instance.id,
      part: instance.definition_id,
      placement_mm: [
        rest.position_m[0] * METRES_TO_MM,
        rest.position_m[1] * METRES_TO_MM,
        rest.position_m[2] * METRES_TO_MM,
      ] as [number, number, number],
      rotation: [...rest.rotation_quaternion_xyzw] as [number, number, number, number],
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
    return [{ id: mate.id, kind: mate.type_id as AssemblyMateKind, a, b }];
  });

  return {
    job: { parts, instances, joints },
    untranslated,
    complete: untranslated.length === 0,
  };
}
