/** Pure adapters bridging canonical `AssemblyProjectionV1` to Aether-Engine's
 *  assembly kinematics (`solveAssemblyIK`, `sweepJoint`, `findJointLimits`),
 *  parallel-axis mass properties (`computeAssemblyMassProperties`), and URDF export. */
import { Matrix4, Quaternion, Vector3 } from "three";
import { computeAssemblyMassProperties, exportAssemblyURDF, type AssemblyOccurrenceMass, type BomType } from "@aether/core/assembly";
import { findJointLimits, solvableMateKinds, solveAssemblyIK, sweepJoint } from "@aether/core/kernel";
import type { AssemblyJobInput, AssemblyMateKind } from "@aether/core/contracts";
import type { AssemblyProjectionV1 } from "../core/cad-assembly-bridge";

function frameQuat(primary: readonly [number, number, number], secondary: readonly [number, number, number]): [number, number, number, number] {
  const z = new Vector3(...primary).normalize();
  const s = new Vector3(...secondary);
  const x = s.clone().addScaledVector(z, -s.dot(z));
  if (x.lengthSq() < 1e-12) {
    x.set(Math.abs(z.x) < 0.9 ? 1 : 0, Math.abs(z.x) < 0.9 ? 0 : 1, 0).addScaledVector(z, -0);
    x.crossVectors(z, x).normalize();
  } else {
    x.normalize();
  }
  const y = new Vector3().crossVectors(z, x).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  return [q.x, q.y, q.z, q.w];
}

export function assemblyOccurrencesFromProjection(projection: AssemblyProjectionV1): AssemblyOccurrenceMass[] {
  const defs = new Map(projection.part_definitions.map((p) => [p.id, p]));
  return projection.instances
    .filter((i) => !i.suppressed)
    .map((inst) => {
      const def = defs.get(inst.definition_id);
      const bomProp = def?.custom_properties?.find((p) => p.key === "bom_type")?.value;
      const bomType: BomType = bomProp && ["normal", "phantom", "reference", "purchased", "inseparable"].includes(bomProp) ? (bomProp as BomType) : "normal";
      const pos = inst.solved_world_transform?.position_m ?? inst.rest_transform?.position_m ?? [0, 0, 0];
      const rot = inst.solved_world_transform?.rotation_quaternion_xyzw ?? inst.rest_transform?.rotation_quaternion_xyzw ?? [0, 0, 0, 1];
      return {
        instanceId: inst.id,
        partId: inst.definition_id,
        partNumber: def?.part_number ?? def?.name ?? inst.definition_id,
        name: inst.name,
        bomType,
        ...(inst.parent_instance_id ? { parentInstanceId: inst.parent_instance_id } : {}),
        massKg: def?.mass_kg ?? 0,
        volumeMm3: 0,
        centerOfMassLocalMm: [0, 0, 0],
        placementMm: [pos[0] * 1000, pos[1] * 1000, pos[2] * 1000],
        rotation: [rot[0], rot[1], rot[2], rot[3]],
      };
    });
}

export function assemblyJobFromProjection(projection: AssemblyProjectionV1): AssemblyJobInput {
  const connectorMap = new Map((projection.connector_definitions ?? []).map((c) => [c.id, c]));
  const endOf = (ep: { instance_id: string; connector_definition_id: string }) => {
    const conn = connectorMap.get(ep.connector_definition_id);
    if (!conn) return { instance: ep.instance_id };
    return {
      instance: ep.instance_id,
      placement_mm: conn.frame_part_local.origin_m.map((v) => v * 1000) as [number, number, number],
      rotation: frameQuat(conn.frame_part_local.primary_axis_xyz, conn.frame_part_local.secondary_axis_xyz),
    };
  };
  return {
    parts: projection.part_definitions.map((p) => ({ id: p.id })),
    instances: projection.instances.filter((i) => !i.suppressed).map((inst) => {
      const pos = inst.solved_world_transform?.position_m ?? inst.rest_transform?.position_m ?? [0, 0, 0];
      const rot = inst.solved_world_transform?.rotation_quaternion_xyzw ?? inst.rest_transform?.rotation_quaternion_xyzw ?? [0, 0, 0, 1];
      return {
        id: inst.id,
        part: inst.definition_id,
        grounded: inst.grounded,
        placement_mm: [pos[0] * 1000, pos[1] * 1000, pos[2] * 1000],
        rotation: [rot[0], rot[1], rot[2], rot[3]],
      };
    }),
    joints: (projection.mates ?? [])
      .filter((m) => !m.suppressed && solvableMateKinds.includes(m.type_id as AssemblyMateKind))
      .map((m) => ({
        id: m.id,
        kind: m.type_id as AssemblyMateKind,
        a: endOf(m.endpoint_a),
        b: endOf(m.endpoint_b),
        parameters: {
          limits: (m.dofs ?? [])
            .filter((d) => d.limit_min_rad !== null || d.limit_max_rad !== null || d.limit_min_m !== null || d.limit_max_m !== null)
            .map((d) => ({
              dof: d.name,
              ...(d.kind === "rotation"
                ? {
                    ...(d.limit_min_rad !== null ? { min: (d.limit_min_rad * 180) / Math.PI } : {}),
                    ...(d.limit_max_rad !== null ? { max: (d.limit_max_rad * 180) / Math.PI } : {}),
                  }
                : {
                    ...(d.limit_min_m !== null ? { min: d.limit_min_m * 1000 } : {}),
                    ...(d.limit_max_m !== null ? { max: d.limit_max_m * 1000 } : {}),
                  }),
            })),
        },
      })),
  };
}

export function runAssemblyMassReport(projection: AssemblyProjectionV1) {
  return computeAssemblyMassProperties(assemblyOccurrencesFromProjection(projection));
}

export function runAssemblyIKQuery(
  projection: AssemblyProjectionV1,
  args: { instance_id: string; target_mm: [number, number, number]; local_point_mm?: [number, number, number]; tolerance_mm?: number },
) {
  return solveAssemblyIK(assemblyJobFromProjection(projection), {
    targetInstanceId: args.instance_id,
    targetWorldMm: args.target_mm,
    ...(args.local_point_mm ? { localPointMm: args.local_point_mm } : {}),
    ...(args.tolerance_mm !== undefined ? { toleranceMm: args.tolerance_mm } : {}),
  });
}

export function runAssemblySweepQuery(
  projection: AssemblyProjectionV1,
  args: { mate_id: string; dof_name: string; from: number; to: number; steps?: number },
) {
  return sweepJoint(assemblyJobFromProjection(projection), args.mate_id, args.dof_name, args.from, args.to, args.steps ?? 10);
}

export function runAssemblyFindLimitsQuery(
  projection: AssemblyProjectionV1,
  args: { mate_id: string; dof_name: string; search_min: number; search_max: number; origin_value?: number },
) {
  return findJointLimits(assemblyJobFromProjection(projection), args.mate_id, args.dof_name, args.search_min, args.search_max, {
    ...(args.origin_value !== undefined ? { originValue: args.origin_value } : {}),
  });
}

export function runAssemblyURDFExport(projection: AssemblyProjectionV1, robotName?: string): string {
  const occurrences = assemblyOccurrencesFromProjection(projection);
  const job = assemblyJobFromProjection(projection);
  return exportAssemblyURDF({
    robotName: robotName || projection.assemblies?.[0]?.name || projection.assembly_id || "aether_robot",
    occurrences,
    joints: job.joints,
  });
}
