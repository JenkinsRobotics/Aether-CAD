/** Assemblies solved in-process: rigid instances, mates as constraints on the
 *  relative pose of two connector frames, Levenberg–Marquardt on the free
 *  poses. Same job and answer as the FreeCAD service (`aether_freecad/
 *  assembly.py`): grounded instances stay, nothing grounded holds the first
 *  one and says so, every mate is checked after the solve as FreeCAD's
 *  acceptance did (`assembly_residuals.py`), and a partial solve publishes no
 *  placements. */
import type { AssemblyDiagnostic, AssemblyJobInput, AssemblyJoint, AssemblyJointEnd, AssemblyJointValue, AssemblyMateKind, AssemblyRelation, AssemblySolution } from "../contracts/assembly";

type V3 = [number, number, number];
type Q = [number, number, number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qnorm = (q: Q): Q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const rotate = (q: Q, v: V3): V3 => {
  const [x, y, z, w] = q;
  const t: V3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
};
/** The rotation of a small rotation vector (axis × angle). */
const expq = (w: V3): Q => { const a = norm(w); if (a < 1e-12) return [w[0] / 2, w[1] / 2, w[2] / 2, 1]; const s = Math.sin(a / 2) / a; return qnorm([w[0] * s, w[1] * s, w[2] * s, Math.cos(a / 2)]); };

interface Pose { p: V3; q: Q }
interface Frame { o: V3; x: V3; y: V3; z: V3 }
interface OrientedFrame extends Frame { q: Q }

/** The joint coordinate system of one mate end, in the world. */
function frameOf(pose: Pose, end: AssemblyJointEnd): OrientedFrame {
  const local: V3 = end.placement_mm ? [...end.placement_mm] as V3 : [0, 0, 0];
  const rot: Q = end.rotation ? qnorm([...end.rotation] as Q) : [0, 0, 0, 1];
  const q = qmul(pose.q, rot);
  return { q, o: add(pose.p, rotate(pose.q, local)), x: rotate(q, [1, 0, 0]), y: rotate(q, [0, 1, 0]), z: rotate(q, [0, 0, 1]) };
}

/** Orientation residuals are unit-vector components; this many millimetres
 *  per radian puts them on the scale of the position residuals. */
const ORIENTATION_SCALE = 100;

/** The degrees of freedom each kind has, named as the workspace names them, so a relation
 *  can couple a mate that holds no value of its own. */
const DOF_TEMPLATES: Record<string, AssemblyJointValue[]> = {
  revolute: [{ name: "rotation", kind: "rotation", axis: "z", value: 0 }],
  prismatic: [{ name: "translation", kind: "translation", axis: "z", value: 0 }],
  cylindrical: [{ name: "rotation", kind: "rotation", axis: "z", value: 0 }, { name: "translation", kind: "translation", axis: "z", value: 0 }],
  planar: [{ name: "translation_x", kind: "translation", axis: "x", value: 0 }, { name: "translation_y", kind: "translation", axis: "y", value: 0 }, { name: "rotation", kind: "rotation", axis: "z", value: 0 }],
  pin_slot: [{ name: "translation", kind: "translation", axis: "x", value: 0 }, { name: "rotation", kind: "rotation", axis: "z", value: 0 }],
  sweep: [{ name: "position", kind: "translation", axis: "x", value: 0 }],
  parallel: [{ name: "translation_x", kind: "translation", axis: "x", value: 0 }, { name: "translation_y", kind: "translation", axis: "y", value: 0 }, { name: "translation_z", kind: "translation", axis: "z", value: 0 }, { name: "rotation", kind: "rotation", axis: "z", value: 0 }],
  ball: [{ name: "rotation_x", kind: "rotation", axis: "x", value: 0 }, { name: "rotation_y", kind: "rotation", axis: "y", value: 0 }, { name: "rotation_z", kind: "rotation", axis: "z", value: 0 }],
};
const templateDof = (kind: AssemblyMateKind, name: string) => DOF_TEMPLATES[kind]?.find((d) => d.name === name);

/** The mates the in-process solver can solve: joints the frames define alone.
 *  Rack and pinion, screw, gears and belt couple other joints' motion. */
export const solvableMateKinds: readonly AssemblyMateKind[] = ["fastened", "revolute", "cylindrical", "prismatic", "ball", "distance", "parallel", "perpendicular", "angle", "planar", "pin_slot", "sweep"];

/** Sweep (path) mate: b's origin rides the polyline `path_mm` given in a's frame. Its one degree
 *  of freedom, `position`, is the arc length along the path in mm; held when a dof carries it,
 *  else b sits wherever on the path is nearest. Orientation is free (a point on a curve). */
function sweepResiduals(a: Frame, b: Frame, parameters: Record<string, unknown>): number[] {
  const raw = parameters.path_mm as number[][] | undefined;
  if (!Array.isArray(raw) || raw.length < 2 || raw.some((p) => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite))) throw new Error("A sweep mate needs path_mm: two or more [x, y, z] points in the first connector's frame.");
  const mul = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
  const path = raw.map((p) => add(a.o, add(mul(a.x, p[0]), add(mul(a.y, p[1]), mul(a.z, p[2])))));
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + norm(sub(path[i], path[i - 1])));
  const held = ((parameters.dofs as AssemblyJointValue[] | undefined) ?? []).find((d) => d.name === "position");
  let target: V3 | undefined;
  if (held) {
    const s = Math.min(Math.max(held.value, 0), lengths[lengths.length - 1]);
    const i = Math.max(1, lengths.findIndex((l) => l >= s));
    const t = lengths[i] === lengths[i - 1] ? 0 : (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
    target = add(path[i - 1], mul(sub(path[i], path[i - 1]), t));
  } else {
    let best = Infinity;
    for (let i = 1; i < path.length; i++) {
      const d = sub(path[i], path[i - 1]), l2 = dot(d, d);
      const t = l2 ? Math.min(Math.max(dot(sub(b.o, path[i - 1]), d) / l2, 0), 1) : 0;
      const q = add(path[i - 1], mul(d, t)), dist = norm(sub(b.o, q));
      if (dist < best) { best = dist; target = q; }
    }
  }
  return sub(b.o, target!);
}

/** The residual vector of one mate between two world frames (zero when satisfied). */
/** A degree of freedom's current value between two frames: the travel of b's origin along
 *  a's axis (mm), or the turn from a's to b's companion axis about it (degrees, signed). */
export function dofValue(kind: "rotation" | "translation", axis: "x" | "y" | "z", a: Frame, b: Frame): number {
  if (kind === "translation") return dot(sub(b.o, a.o), a[axis]);
  const companion = axis === "z" ? "x" : axis === "x" ? "y" : "z";
  const u = a[companion], v = b[companion], n = a[axis];
  return Math.atan2(dot(cross(u, v), n), dot(u, v)) * 180 / Math.PI;
}
const angleGap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const inverseQ = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];

/** Ball coordinates are successive local X/Y/Z rotations, not three
 * independent angles measured about the first connector's fixed axes. */
function ballRotation(values: AssemblyJointValue[]): Q {
  return (["x", "y", "z"] as const).reduce<Q>((q, axis, index) => {
    const w: V3 = [0, 0, 0];
    w[index] = values.find(dof => dof.name === `rotation_${axis}`)!.value * Math.PI / 180;
    return qmul(q, expq(w));
  }, [0, 0, 0, 1]);
}

function heldRotation(kind: AssemblyMateKind, values: AssemblyJointValue[]): Q | undefined {
  if (kind === "ball" && values.length === 3) return ballRotation(values);
  if (kind === "fastened" || kind === "prismatic") return [0, 0, 0, 1];
  const turn = values.find(d => d.name === "rotation" && d.kind === "rotation" && d.axis === "z");
  if (turn && ["revolute", "cylindrical", "planar", "pin_slot", "parallel"].includes(kind))
    return expq([0, 0, turn.value * Math.PI / 180]);
}

function orientationResidual(target: Q, actual: Q, hemisphere: number): number[] {
  // Keep this branch fixed through finite differences. Choosing the shortest
  // quaternion on every sample makes an exact half-turn discontinuous.
  const error = qnorm(qmul(inverseQ(target), actual)).map(v => hemisphere * v) as Q;
  const length = Math.hypot(error[0], error[1], error[2]);
  const scale = length < 1e-12 ? 2 : 2 * Math.atan2(length, error[3]) / length;
  return error.slice(0, 3).map(v => ORIENTATION_SCALE * scale * v);
}

/** Residuals holding authored or relation-resolved coordinates. Full ball
 * orientation avoids Euler branch ambiguity and works at gimbal lock. */
function valueResiduals(a: OrientedFrame, b: OrientedFrame, kind: AssemblyMateKind, parameters: Record<string, unknown> = {}, hemisphere = 1): number[] {
  const values = kind === "sweep" ? [] : (parameters.dofs as AssemblyJointValue[] | undefined) ?? [];
  const rotation = heldRotation(kind, values);
  const orientation = rotation ? orientationResidual(qmul(a.q, rotation), b.q, hemisphere) : [];
  return [...orientation, ...values.filter(dof => !rotation || dof.kind !== "rotation").map(dof => {
    const current = dofValue(dof.kind, dof.axis, a, b);
    return dof.kind === "translation" ? current - dof.value : ORIENTATION_SCALE * Math.PI / 180 * angleGap(current - dof.value);
  })];
}
export function jointResiduals(kind: AssemblyMateKind, a: Frame, b: Frame, parameters: Record<string, unknown> = {}): number[] {
  const d = sub(b.o, a.o), S = ORIENTATION_SCALE;
  const coincide = () => [d[0], d[1], d[2]];
  const onAxis = () => [dot(d, a.x), dot(d, a.y)];
  const zAligned = () => [S * dot(b.z, a.x), S * dot(b.z, a.y)];
  const sameTurn = () => [S * dot(b.x, a.y)];
  switch (kind) {
    case "fastened": {
      // Equal frames: coincident origins and matching axes (half the sum of the cross products is the small-angle error).
      const e = add(add(cross(a.x, b.x), cross(a.y, b.y)), cross(a.z, b.z));
      return [...coincide(), S * e[0] / 2, S * e[1] / 2, S * e[2] / 2];
    }
    case "revolute": return [...coincide(), ...zAligned()];
    case "cylindrical": return [...onAxis(), ...zAligned()];
    case "prismatic": return [...onAxis(), ...zAligned(), ...sameTurn()];
    case "ball": return coincide();
    case "distance": return [norm(d) - Number(parameters.distance_mm ?? 0)];
    case "parallel": { const c = cross(a.z, b.z); return [S * c[0], S * c[1], S * c[2]]; }
    case "perpendicular": return [S * dot(a.z, b.z)];
    case "angle": return [S * (dot(a.z, b.z) - Math.cos((Number(parameters.angle_deg ?? 0)) * Math.PI / 180))];
    // Planar: b's origin stays in a's plane and the normals align; it slides and turns in the plane.
    case "planar": return [dot(d, a.z), ...zAligned()];
    // Pin slot: a revolute that may also slide along a's x (the slot's length).
    case "pin_slot": return [dot(d, a.y), dot(d, a.z), ...zAligned()];
    case "sweep": return sweepResiduals(a, b, parameters);
    default: return [];
  }
}

/** Solve a dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] | undefined {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-300) return undefined;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

export function solveAssemblyJob(job: AssemblyJobInput): AssemblySolution {
  const started = performance.now();
  const diagnostics: AssemblyDiagnostic[] = [];
  const parts = new Set(job.parts.map((part) => part.id));
  const poses = new Map<string, Pose>();
  for (const instance of job.instances) {
    if (!parts.has(instance.part)) { diagnostics.push({ feature_id: instance.id, severity: "error", message: `no part definition '${instance.part}' to place` }); continue; }
    poses.set(instance.id, { p: instance.placement_mm ? [...instance.placement_mm] as V3 : [0, 0, 0], q: instance.rotation ? qnorm([...instance.rotation] as Q) : [0, 0, 0, 1] });
  }
  const grounded = new Set(job.instances.filter((i) => i.grounded && poses.has(i.id)).map((i) => i.id));
  if (!grounded.size && poses.size) {
    const first = job.instances.find((i) => poses.has(i.id))!;
    grounded.add(first.id);
    diagnostics.push({ feature_id: first.id, severity: "warning", message: "nothing was grounded, so this instance was held fixed" });
  }
  const joints: AssemblyJoint[] = [];
  for (const joint of job.joints) {
    if (!solvableMateKinds.includes(joint.kind)) { diagnostics.push({ feature_id: joint.id, severity: "error", message: `unsupported mate kind '${joint.kind}'` }); continue; }
    if (!poses.has(joint.a.instance) || !poses.has(joint.b.instance)) { diagnostics.push({ feature_id: joint.id, severity: "error", message: "a mate names an instance that is not in the assembly" }); continue; }
    joints.push({ ...joint, parameters: { ...joint.parameters, dofs: ((joint.parameters?.dofs as AssemblyJointValue[] | undefined) ?? []).map(dof => ({ ...dof })) } });
  }
  const free = [...poses.keys()].filter((id) => !grounded.has(id));
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const relations: AssemblyRelation[] = [];
  const dofOf = (joint: AssemblyJoint, name: string): AssemblyJointValue | undefined => ((joint.parameters?.dofs as AssemblyJointValue[] | undefined) ?? []).find(d => d.name === name) ?? templateDof(joint.kind, name);
  for (const relation of job.relations ?? []) {
    const driver = byId.get(relation.driver.joint), driven = byId.get(relation.driven.joint);
    if (!driver || !driven) { diagnostics.push({ feature_id: relation.id, severity: "error", message: "a relation couples a mate that is not solved" }); continue; }
    if (!dofOf(driver, relation.driver.dof) || !dofOf(driven, relation.driven.dof)
        || !Number.isFinite(relation.ratio) || !Number.isFinite(relation.offset ?? 0)) {
      diagnostics.push({ feature_id: relation.id, severity: "error", message: "a relation has an invalid coordinate, ratio or offset" }); continue;
    }
    relations.push(relation);
  }
  const heldValue = (joint: AssemblyJoint, name: string) => (joint.parameters!.dofs as AssemblyJointValue[]).find(d => d.name === name);
  const relationTarget = (relation: AssemblyRelation, x: number) => (relation.reversed ? -relation.ratio : relation.ratio) * x + (relation.offset ?? 0);
  // Carry scalar coordinates through relations before solving poses. This
  // preserves multi-turn values and supplies a ball's dependent XYZ coordinate
  // without trying to infer a unique Euler branch from its rendered quaternion.
  for (let pass = 0; pass < relations.length; pass++) {
    let added = false;
    for (const relation of relations) {
      const driver = byId.get(relation.driver.joint)!, driven = byId.get(relation.driven.joint)!;
      const x = heldValue(driver, relation.driver.dof);
      if (x && !heldValue(driven, relation.driven.dof)) {
        (driven.parameters!.dofs as AssemblyJointValue[]).push({ ...dofOf(driven, relation.driven.dof)!, value: relationTarget(relation, x.value) });
        added = true;
      }
    }
    if (!added) break;
  }
  for (const joint of joints) {
    const values = joint.parameters!.dofs as AssemblyJointValue[];
    const names = new Set(values.map(d => d.name));
    if (names.size !== values.length || values.some(d => {
      const expected = templateDof(joint.kind, d.name);
      return !Number.isFinite(d.value) || !expected || expected.kind !== d.kind || expected.axis !== d.axis;
    })) diagnostics.push({ feature_id: joint.id, severity: "error", message: "a mate coordinate is invalid, duplicate or not finite" });
    const ballConstrained = values.length || relations.some(r => r.driver.joint === joint.id || r.driven.joint === joint.id);
    if (joint.kind === "ball" && ballConstrained && (values.length !== 3 || DOF_TEMPLATES.ball.some(d => !values.some(v => v.name === d.name && v.kind === d.kind && v.axis === d.axis))))
      diagnostics.push({ feature_id: joint.id, severity: "error", message: "a driven ball mate requires resolved X, Y and Z rotation coordinates" });
  }
  const orientationHemispheres = new Map<string, number>();
  for (const joint of joints) {
    const values = joint.parameters!.dofs as AssemblyJointValue[];
    if (diagnostics.some(d => d.feature_id === joint.id && d.severity === "error")) continue;
    const rotation = heldRotation(joint.kind, values);
    if (!rotation) continue;
    const a = frameOf(poses.get(joint.a.instance)!, joint.a), b = frameOf(poses.get(joint.b.instance)!, joint.b);
    const target = qmul(a.q, rotation);
    orientationHemispheres.set(joint.id, qmul(inverseQ(target), b.q)[3] < 0 ? -1 : 1);
  }
  const relationResidual = (relation: AssemblyRelation, current: Map<string, Pose>): number[] => {
    const driver = byId.get(relation.driver.joint)!, driven = byId.get(relation.driven.joint)!;
    const d1 = dofOf(driver, relation.driver.dof)!, d2 = dofOf(driven, relation.driven.dof)!;
    const measure = (joint: AssemblyJoint, dof: AssemblyJointValue) => heldValue(joint, dof.name)?.value
      ?? dofValue(dof.kind, dof.axis, frameOf(current.get(joint.a.instance)!, joint.a), frameOf(current.get(joint.b.instance)!, joint.b));
    const gap = measure(driven, d2) - relationTarget(relation, measure(driver, d1));
    // When both coordinates are authored/resolved, whole turns are meaningful
    // (a downstream ratio may be fractional). Do not hide a 360-degree conflict.
    const exact = heldValue(driver, d1.name) && heldValue(driven, d2.name);
    return [d2.kind === "translation" ? gap : ORIENTATION_SCALE * Math.PI / 180 * (exact ? gap : angleGap(gap))];
  };
  const relationResiduals = (current: Map<string, Pose>) => relations.flatMap(relation => relationResidual(relation, current));
  const residuals = (current: Map<string, Pose>): number[] => [
    ...joints.flatMap((joint) => { const fa = frameOf(current.get(joint.a.instance)!, joint.a), fb = frameOf(current.get(joint.b.instance)!, joint.b); return [...jointResiduals(joint.kind, fa, fb, joint.parameters), ...valueResiduals(fa, fb, joint.kind, joint.parameters, orientationHemispheres.get(joint.id))]; }),
    ...relationResiduals(current),
  ];
  const errorsBefore = diagnostics.filter((d) => d.severity === "error");
  if (!errorsBefore.length && free.length && (joints.length || relations.length)) {
    // Levenberg–Marquardt on the free poses: each step is six numbers per
    // instance (a translation and a rotation vector applied to the current pose).
    let lambda = 1e-3;
    let r = residuals(poses), cost = r.reduce((s, v) => s + v * v, 0);
    for (let iteration = 0; iteration < 200 && cost > 1e-18; iteration++) {
      const n = free.length * 6, m = r.length;
      const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
      const h = 1e-5;
      free.forEach((id, k) => {
        const base = poses.get(id)!;
        for (let axis = 0; axis < 6; axis++) {
          const perturbed = (sign: number) => {
            const copy = new Map(poses);
            const t: V3 = [0, 0, 0], w: V3 = [0, 0, 0];
            if (axis < 3) t[axis] = sign * h; else w[axis - 3] = sign * h;
            copy.set(id, { p: add(base.p, t), q: qnorm(qmul(expq(w), base.q)) });
            return residuals(copy);
          };
          const plus = perturbed(1), minus = perturbed(-1);
          for (let i = 0; i < m; i++) J[i][k * 6 + axis] = (plus[i] - minus[i]) / (2 * h);
        }
      });
      const JtJ = Array.from({ length: n }, () => new Array<number>(n).fill(0)), Jtr = new Array<number>(n).fill(0);
      for (let i = 0; i < m; i++) for (let a = 0; a < n; a++) { if (!J[i][a]) continue; Jtr[a] += J[i][a] * r[i]; for (let b = 0; b < n; b++) JtJ[a][b] += J[i][a] * J[i][b]; }
      let improved = false;
      for (let attempt = 0; attempt < 12 && !improved; attempt++) {
        const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (v + 1e-9) : v)));
        const step = solveLinear(A, Jtr.map((v) => -v));
        if (!step) { lambda *= 10; continue; }
        const trial = new Map(poses);
        free.forEach((id, k) => { const base = poses.get(id)!; const t: V3 = [step[k * 6], step[k * 6 + 1], step[k * 6 + 2]], w: V3 = [step[k * 6 + 3], step[k * 6 + 4], step[k * 6 + 5]]; trial.set(id, { p: add(base.p, t), q: qnorm(qmul(expq(w), base.q)) }); });
        const trialResiduals = residuals(trial), trialCost = trialResiduals.reduce((s, v) => s + v * v, 0);
        if (trialCost < cost) {
          for (const [id, pose] of trial) poses.set(id, pose);
          const moved = Math.hypot(...step);
          r = trialResiduals; cost = trialCost; lambda = Math.max(1e-12, lambda / 3); improved = true;
          if (moved < 1e-12) iteration = 200;
        } else lambda *= 4;
      }
      if (!improved) break;
    }
  }
  // Acceptance, as FreeCAD's residual check: every mate must hold after the solve.
  if (!errorsBefore.length) {
    for (const joint of joints) {
      const fa = frameOf(poses.get(joint.a.instance)!, joint.a), fb = frameOf(poses.get(joint.b.instance)!, joint.b);
      const values = [...jointResiduals(joint.kind, fa, fb, joint.parameters), ...valueResiduals(fa, fb, joint.kind, joint.parameters, orientationHemispheres.get(joint.id))];
      const worst = Math.max(0, ...values.map(Math.abs));
      if (!Number.isFinite(worst) || worst > 1e-4) diagnostics.push({ feature_id: joint.id, severity: "error", message: `Mate is not satisfied after solving: residual ${worst.toExponential(3)} exceeds 1e-4. Check conflicting mates or connector references.` });
    }
  }
  if (!errorsBefore.length) for (const relation of relations) {
    const worst = Math.max(...relationResidual(relation, poses).map(Math.abs));
    if (!Number.isFinite(worst) || worst > 1e-4) diagnostics.push({ feature_id: relation.id, severity: "error", message: `Relation is not satisfied after solving: residual ${worst.toExponential(3)} exceeds 1e-4. Check conflicting coordinates or relations.` });
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  const message = errors.map((d) => d.message).join("; ");
  return {
    status: message ? "error" : "ok",
    engine: "Aether",
    message,
    solve_seconds: Math.round((performance.now() - started)) / 1000,
    instances: errors.length ? [] : job.instances.filter((i) => poses.has(i.id)).map((i) => { const pose = poses.get(i.id)!; return { id: i.id, placement_mm: [...pose.p] as V3, rotation: [...pose.q] as Q }; }),
    diagnostics,
  };
}
