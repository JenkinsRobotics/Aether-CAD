/** ROS / Gazebo URDF exporter (`export.urdf`): emits `<robot>`, `<link>` (with `<inertial>`,
 *  `<visual>`, `<collision>`), and `<joint>` (`fixed`, `revolute`, `continuous`, `prismatic`)
 *  converting Aether millimeters and degrees into standard SI meters and radians. */
import type { AssemblyJoint, AssemblyJointLimit, AssemblyJointValue } from "../contracts/assembly";
import type { AssemblyOccurrenceMass } from "./mass-and-bom";

export interface UrdfExportSpec {
  robotName: string;
  occurrences: readonly AssemblyOccurrenceMass[];
  joints: readonly AssemblyJoint[];
  /** Optional prefix for mesh filenames (default `"meshes/"`). */
  meshPrefix?: string;
}

function xmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
}

function sanitizeUrdfName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_") || "unnamed";
}

/** Convert unit quaternion [x, y, z, w] to URDF extrinsic XYZ (roll, pitch, yaw) radians. */
function quatToRpy(q: readonly [number, number, number, number]): [number, number, number] {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const x = q[0] / l, y = q[1] / l, z = q[2] / l, w = q[3] / l;
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr, cosr);
  const sinp = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const pitch = Math.asin(sinp);
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny, cosy);
  return [roll, pitch, yaw];
}

const fmt = (n: number) => (Math.abs(n) < 1e-12 ? "0" : Number(n.toFixed(6)).toString());

export function exportAssemblyURDF(spec: UrdfExportSpec): string {
  const robot = sanitizeUrdfName(spec.robotName);
  const prefix = spec.meshPrefix ?? "meshes/";
  const lines: string[] = [
    `<?xml version="1.0"?>`,
    `<robot name="${xmlEscape(robot)}">`,
  ];

  const byId = new Map(spec.occurrences.map((o) => [o.instanceId, o]));
  const linkNames = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const occ of spec.occurrences) {
    let base = sanitizeUrdfName(occ.name || occ.instanceId);
    let candidate = base, n = 1;
    while (usedNames.has(candidate)) candidate = `${base}_${n++}`;
    usedNames.add(candidate);
    linkNames.set(occ.instanceId, candidate);
  }

  for (const occ of spec.occurrences) {
    const linkName = linkNames.get(occ.instanceId)!;
    const comM = occ.centerOfMassLocalMm.map((v) => v / 1000);
    // Convert kg·mm² -> kg·m² (1e-6)
    const I = occ.inertiaLocalKgMm2 ?? [0, 0, 0, 0, 0, 0];
    const [ixx, iyy, izz, ixy, ixz, iyz] = I.map((v) => v * 1e-6);
    const meshFile = `${prefix}${sanitizeUrdfName(occ.partId)}.stl`;

    lines.push(`  <link name="${xmlEscape(linkName)}">`);
    lines.push(`    <inertial>`);
    lines.push(`      <origin xyz="${comM.map(fmt).join(" ")}" rpy="0 0 0"/>`);
    lines.push(`      <mass value="${fmt(Math.max(0, occ.massKg))}"/>`);
    lines.push(`      <inertia ixx="${fmt(ixx)}" ixy="${fmt(ixy)}" ixz="${fmt(ixz)}" iyy="${fmt(iyy)}" iyz="${fmt(iyz)}" izz="${fmt(izz)}"/>`);
    lines.push(`    </inertial>`);
    lines.push(`    <visual>`);
    lines.push(`      <origin xyz="0 0 0" rpy="0 0 0"/>`);
    lines.push(`      <geometry><mesh filename="${xmlEscape(meshFile)}" scale="0.001 0.001 0.001"/></geometry>`);
    lines.push(`    </visual>`);
    lines.push(`    <collision>`);
    lines.push(`      <origin xyz="0 0 0" rpy="0 0 0"/>`);
    lines.push(`      <geometry><mesh filename="${xmlEscape(meshFile)}" scale="0.001 0.001 0.001"/></geometry>`);
    lines.push(`    </collision>`);
    lines.push(`  </link>`);
  }

  for (const joint of spec.joints) {
    const parent = linkNames.get(joint.a.instance);
    const child = linkNames.get(joint.b.instance);
    if (!parent || !child || !byId.has(joint.a.instance) || !byId.has(joint.b.instance)) continue;

    const dofs = (joint.parameters?.dofs as AssemblyJointValue[] | undefined) ?? [];
    const lims = (joint.parameters?.limits as AssemblyJointLimit[] | undefined) ?? [];
    const primaryLim = lims[0] ?? (dofs[0] && (dofs[0].min_value !== undefined || dofs[0].max_value !== undefined) ? { dof: dofs[0].name, min: dofs[0].min_value, max: dofs[0].max_value } : undefined);

    let urdfType: "fixed" | "revolute" | "continuous" | "prismatic" = "fixed";
    if (joint.kind === "revolute" || joint.kind === "cylindrical") {
      urdfType = primaryLim && (primaryLim.min !== undefined || primaryLim.max !== undefined) ? "revolute" : "continuous";
    } else if (joint.kind === "prismatic") {
      urdfType = "prismatic";
    }

    const xyzM = (joint.a.placement_mm ?? [0, 0, 0]).map((v) => v / 1000);
    const rpy = quatToRpy(joint.a.rotation ?? [0, 0, 0, 1]);
    const jName = sanitizeUrdfName(joint.id);
    lines.push(`  <joint name="${xmlEscape(jName)}" type="${urdfType}">`);
    lines.push(`    <parent link="${xmlEscape(parent)}"/>`);
    lines.push(`    <child link="${xmlEscape(child)}"/>`);
    lines.push(`    <origin xyz="${xyzM.map(fmt).join(" ")}" rpy="${rpy.map(fmt).join(" ")}"/>`);
    if (urdfType !== "fixed") {
      lines.push(`    <axis xyz="0 0 1"/>`);
    }
    if (urdfType === "revolute" || urdfType === "prismatic") {
      const scale = urdfType === "revolute" ? Math.PI / 180 : 0.001;
      const lower = (primaryLim?.min ?? (urdfType === "revolute" ? -180 : -1000)) * scale;
      const upper = (primaryLim?.max ?? (urdfType === "revolute" ? 180 : 1000)) * scale;
      lines.push(`    <limit lower="${fmt(lower)}" upper="${fmt(upper)}" effort="100" velocity="10"/>`);
    }
    lines.push(`  </joint>`);
  }

  lines.push(`</robot>`);
  return lines.join("\n") + "\n";
}
