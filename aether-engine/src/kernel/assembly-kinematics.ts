/** Assembly kinematics (SolidCraft's `joint.reach`, `joint.drive`, `joint.sweep`, `joint.find_limits`):
 *  damped Levenberg–Marquardt inverse kinematics on the constrained pose manifold,
 *  limit-aware joint driving with optional contact stop, mechanism sweep, and binary-search
 *  feasible travel discovery. */
import type {
  AssemblyDiagnostic,
  AssemblyJobInput,
  AssemblyJoint,
  AssemblyJointEnd,
  AssemblyJointLimit,
  AssemblyJointValue,
  AssemblyRelation,
  AssemblySolution,
  SolvedInstance,
} from "../contracts/assembly";
import { dofValue, evaluateCamTable, jointResiduals, solvableMateKinds, solveAssemblyJob } from "./assembly-solver";

type V3 = [number, number, number];
type Q = [number, number, number, number];
interface Pose { p: V3; q: Q }
interface OrientedFrame { o: V3; x: V3; y: V3; z: V3; q: Q }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
const expq = (w: V3): Q => { const a = norm(w); if (a < 1e-12) return [w[0] / 2, w[1] / 2, w[2] / 2, 1]; const s = Math.sin(a / 2) / a; return qnorm([w[0] * s, w[1] * s, w[2] * s, Math.cos(a / 2)]); };

const DOF_TEMPLATES: Record<string, { name: string; kind: "rotation" | "translation"; axis: "x" | "y" | "z" }[]> = {
  revolute: [{ name: "rotation", kind: "rotation", axis: "z" }],
  prismatic: [{ name: "translation", kind: "translation", axis: "z" }],
  cylindrical: [{ name: "rotation", kind: "rotation", axis: "z" }, { name: "translation", kind: "translation", axis: "z" }],
  planar: [{ name: "translation_x", kind: "translation", axis: "x" }, { name: "translation_y", kind: "translation", axis: "y" }, { name: "rotation", kind: "rotation", axis: "z" }],
  pin_slot: [{ name: "translation", kind: "translation", axis: "x" }, { name: "rotation", kind: "rotation", axis: "z" }],
  ball: [{ name: "rotation_x", kind: "rotation", axis: "x" }, { name: "rotation_y", kind: "rotation", axis: "y" }, { name: "rotation_z", kind: "rotation", axis: "z" }],
};

function frameOf(pose: Pose, end: AssemblyJointEnd): OrientedFrame {
  const local: V3 = end.placement_mm ? [...end.placement_mm] as V3 : [0, 0, 0];
  const rot: Q = end.rotation ? qnorm([...end.rotation] as Q) : [0, 0, 0, 1];
  const q = qmul(pose.q, rot);
  return { q, o: add(pose.p, rotate(pose.q, local)), x: rotate(q, [1, 0, 0]), y: rotate(q, [0, 1, 0]), z: rotate(q, [0, 0, 1]) };
}

function solveLinear(A: number[][], b: number[]): number[] | undefined {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-300) return undefined;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export interface AssemblyIKRequest {
  targetInstanceId: string;
  /** Point in `targetInstanceId`'s local coordinates (mm) to place at `targetWorldMm`. Defaults to `[0, 0, 0]`. */
  localPointMm?: readonly [number, number, number];
  targetWorldMm: readonly [number, number, number];
  /** Tolerance (mm) within which the target is considered reached. Default 0.05 mm. */
  toleranceMm?: number;
  maxIterations?: number;
}

export interface AssemblyIKResult {
  status: "ok" | "error";
  reached: boolean;
  positionErrorMm: number;
  instances: SolvedInstance[];
  jointValues: Record<string, Record<string, number>>;
  diagnostics: AssemblyDiagnostic[];
}

const angleGap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;

/** Solve damped-LM Inverse Kinematics (`joint.reach`) over all free assembly poses while
 *  maintaining every mate, relation, and joint limit. */
export function solveAssemblyIK(job: AssemblyJobInput, request: AssemblyIKRequest): AssemblyIKResult {
  const diagnostics: AssemblyDiagnostic[] = [];
  const tol = request.toleranceMm ?? 0.05;
  const maxIter = request.maxIterations ?? 160;
  const localPt: V3 = request.localPointMm ? [...request.localPointMm] as V3 : [0, 0, 0];
  const target: V3 = [...request.targetWorldMm] as V3;

  const basePoses = new Map<string, Pose>();
  for (const inst of job.instances) {
    basePoses.set(inst.id, {
      p: inst.placement_mm ? [...inst.placement_mm] as V3 : [0, 0, 0],
      q: inst.rotation ? qnorm([...inst.rotation] as Q) : [0, 0, 0, 1],
    });
  }
  if (!basePoses.has(request.targetInstanceId)) {
    return { status: "error", reached: false, positionErrorMm: Infinity, instances: [], jointValues: {}, diagnostics: [{ feature_id: request.targetInstanceId, severity: "error", message: "IK target instance is not in the assembly." }] };
  }

  const grounded = new Set(job.instances.filter((i) => i.grounded).map((i) => i.id));
  if (!grounded.size && job.instances.length) grounded.add(job.instances[0].id);
  const free = [...basePoses.keys()].filter((id) => !grounded.has(id));

  const joints: AssemblyJoint[] = job.joints.filter((j) => solvableMateKinds.includes(j.kind) && basePoses.has(j.a.instance) && basePoses.has(j.b.instance));
  const byId = new Map(joints.map((j) => [j.id, j]));
  const relations: AssemblyRelation[] = (job.relations ?? []).filter((r) => byId.has(r.driver.joint) && byId.has(r.driven.joint));

  // Collect joint limits from both `parameters.limits` and any authored `dofs` min/max.
  const limitsByJoint = new Map<string, AssemblyJointLimit[]>();
  for (const j of joints) {
    const list: AssemblyJointLimit[] = [...((j.parameters?.limits as AssemblyJointLimit[] | undefined) ?? [])];
    for (const d of (j.parameters?.dofs as AssemblyJointValue[] | undefined) ?? []) {
      if (d.min_value !== undefined || d.max_value !== undefined) {
        list.push({ dof: d.name, min: d.min_value, max: d.max_value });
      }
    }
    if (list.length) limitsByJoint.set(j.id, list);
  }

  const JOINT_WEIGHT = 10;
  const LIMIT_WEIGHT = 15;
  const ORIENTATION_SCALE = 100;

  const evalResiduals = (current: Map<string, Pose>): number[] => {
    const out: number[] = [];
    for (const j of joints) {
      const fa = frameOf(current.get(j.a.instance)!, j.a);
      const fb = frameOf(current.get(j.b.instance)!, j.b);
      for (const v of jointResiduals(j.kind, fa, fb, j.parameters)) out.push(v * JOINT_WEIGHT);
      const lims = limitsByJoint.get(j.id);
      if (lims) {
        const templates = DOF_TEMPLATES[j.kind] ?? [];
        for (const lim of lims) {
          const t = templates.find((d) => d.name === lim.dof);
          if (!t) continue;
          const val = dofValue(t.kind, t.axis, fa, fb);
          const sc = t.kind === "translation" ? 1 : ORIENTATION_SCALE * Math.PI / 180;
          if (lim.min !== undefined && val < lim.min) out.push((lim.min - val) * sc * LIMIT_WEIGHT);
          else if (lim.max !== undefined && val > lim.max) out.push((val - lim.max) * sc * LIMIT_WEIGHT);
          else out.push(0);
        }
      }
    }
    for (const rel of relations) {
      const j1 = byId.get(rel.driver.joint)!, j2 = byId.get(rel.driven.joint)!;
      const t1 = (DOF_TEMPLATES[j1.kind] ?? []).find((d) => d.name === rel.driver.dof);
      const t2 = (DOF_TEMPLATES[j2.kind] ?? []).find((d) => d.name === rel.driven.dof);
      if (!t1 || !t2) continue;
      const v1 = dofValue(t1.kind, t1.axis, frameOf(current.get(j1.a.instance)!, j1.a), frameOf(current.get(j1.b.instance)!, j1.b));
      const v2 = dofValue(t2.kind, t2.axis, frameOf(current.get(j2.a.instance)!, j2.a), frameOf(current.get(j2.b.instance)!, j2.b));
      const desired = rel.kind === "cam"
        ? evaluateCamTable(rel.camTable!, v1, Boolean(rel.periodic)) + (rel.offset ?? 0)
        : (rel.reversed ? -rel.ratio : rel.ratio) * v1 + (rel.offset ?? 0);
      const gap = v2 - desired;
      out.push((t2.kind === "translation" ? gap : ORIENTATION_SCALE * Math.PI / 180 * angleGap(gap)) * JOINT_WEIGHT);
    }
    const tp = current.get(request.targetInstanceId)!;
    const worldPt = add(tp.p, rotate(tp.q, localPt));
    const err = sub(worldPt, target);
    out.push(err[0], err[1], err[2]);
    return out;
  };

  const runLM = (seed: Map<string, Pose>): Map<string, Pose> => {
    const poses = new Map<string, Pose>([...seed.entries()].map(([k, v]) => [k, { p: [...v.p] as V3, q: [...v.q] as Q }]));
    if (!free.length) return poses;
    let lambda = 1e-2;
    let r = evalResiduals(poses), cost = r.reduce((s, v) => s + v * v, 0);
    for (let iter = 0; iter < maxIter && cost > 1e-12; iter++) {
      const n = free.length * 6, m = r.length;
      const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
      const h = 1e-5;
      free.forEach((id, k) => {
        const base = poses.get(id)!;
        for (let axis = 0; axis < 6; axis++) {
          const pert = (sign: number) => {
            const copy = new Map(poses);
            const t: V3 = [0, 0, 0], w: V3 = [0, 0, 0];
            if (axis < 3) t[axis] = sign * h; else w[axis - 3] = sign * h;
            copy.set(id, { p: add(base.p, t), q: qnorm(qmul(expq(w), base.q)) });
            return evalResiduals(copy);
          };
          const plus = pert(1), minus = pert(-1);
          for (let i = 0; i < m; i++) J[i][k * 6 + axis] = (plus[i] - minus[i]) / (2 * h);
        }
      });
      const JtJ = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      const Jtr = new Array<number>(n).fill(0);
      for (let i = 0; i < m; i++) {
        for (let a = 0; a < n; a++) {
          if (!J[i][a]) continue;
          Jtr[a] += J[i][a] * r[i];
          for (let b = 0; b < n; b++) JtJ[a][b] += J[i][a] * J[i][b];
        }
      }
      let improved = false;
      for (let attempt = 0; attempt < 12 && !improved; attempt++) {
        const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (v + 1e-6) : v)));
        const step = solveLinear(A, Jtr.map((v) => -v));
        if (!step) { lambda *= 10; continue; }
        const trial = new Map(poses);
        free.forEach((id, k) => {
          const base = poses.get(id)!;
          const t: V3 = [step[k * 6], step[k * 6 + 1], step[k * 6 + 2]];
          const w: V3 = [step[k * 6 + 3], step[k * 6 + 4], step[k * 6 + 5]];
          trial.set(id, { p: add(base.p, t), q: qnorm(qmul(expq(w), base.q)) });
        });
        const tr = evalResiduals(trial), tc = tr.reduce((s, v) => s + v * v, 0);
        if (tc < cost) {
          for (const [id, pose] of trial) poses.set(id, pose);
          r = tr; cost = tc; lambda = Math.max(1e-10, lambda / 3); improved = true;
          if (Math.hypot(...step) < 1e-10) return poses;
        } else lambda *= 4;
      }
      if (!improved) break;
    }
    return poses;
  };

  let bestPoses = runLM(basePoses);
  const score = (poses: Map<string, Pose>) => {
    const tp = poses.get(request.targetInstanceId)!;
    return norm(sub(add(tp.p, rotate(tp.q, localPt)), target));
  };
  let bestErr = score(bestPoses);
  // Escape collinear singularities by trying small rotational nudges if needed.
  if (bestErr > tol && free.length > 0) {
    for (const nudge of [0.35, -0.35, 0.9]) {
      const seeded = new Map<string, Pose>([...basePoses.entries()].map(([k, v], idx) => {
        if (grounded.has(k)) return [k, v];
        const dq = expq([0, 0, nudge * (idx % 2 === 0 ? 1 : -1.3)]);
        return [k, { p: [...v.p] as V3, q: qnorm(qmul(dq, v.q)) }];
      }));
      const cand = runLM(seeded);
      const err = score(cand);
      if (err < bestErr) {
        bestErr = err;
        bestPoses = cand;
        if (bestErr <= tol) break;
      }
    }
  }

  // Verify all geometric joint residuals remain satisfied.
  let maxJointErr = 0;
  for (const j of joints) {
    const fa = frameOf(bestPoses.get(j.a.instance)!, j.a);
    const fb = frameOf(bestPoses.get(j.b.instance)!, j.b);
    maxJointErr = Math.max(maxJointErr, ...jointResiduals(j.kind, fa, fb, j.parameters).map(Math.abs));
  }
  if (maxJointErr > 1e-2) {
    diagnostics.push({ feature_id: request.targetInstanceId, severity: "error", message: `IK could not keep mates satisfied (residual ${maxJointErr.toExponential(2)}).` });
  }

  const jointValues: Record<string, Record<string, number>> = {};
  for (const j of joints) {
    const fa = frameOf(bestPoses.get(j.a.instance)!, j.a);
    const fb = frameOf(bestPoses.get(j.b.instance)!, j.b);
    const vals: Record<string, number> = {};
    for (const d of DOF_TEMPLATES[j.kind] ?? []) {
      vals[d.name] = dofValue(d.kind, d.axis, fa, fb);
    }
    jointValues[j.id] = vals;
  }

  return {
    status: diagnostics.some((d) => d.severity === "error") ? "error" : "ok",
    reached: bestErr <= tol && !diagnostics.some((d) => d.severity === "error"),
    positionErrorMm: bestErr,
    instances: job.instances.map((i) => {
      const p = bestPoses.get(i.id)!;
      return { id: i.id, placement_mm: [...p.p] as V3, rotation: [...p.q] as Q };
    }),
    jointValues,
    diagnostics,
  };
}

function withJointDof(job: AssemblyJobInput, jointId: string, dofName: string, value: number, seed?: SolvedInstance[]): AssemblyJobInput {
  const next = structuredClone(job);
  if (seed?.length) {
    const map = new Map(seed.map((s) => [s.id, s]));
    for (const inst of next.instances) {
      const s = map.get(inst.id);
      if (s && !inst.grounded) {
        inst.placement_mm = [...s.placement_mm];
        inst.rotation = [...s.rotation];
      }
    }
  }
  const joint = next.joints.find((j) => j.id === jointId);
  if (!joint) throw new Error(`Joint "${jointId}" does not exist.`);
  const template = (DOF_TEMPLATES[joint.kind] ?? []).find((d) => d.name === dofName);
  if (!template) throw new Error(`Joint "${jointId}" (${joint.kind}) has no DOF "${dofName}".`);
  joint.parameters = { ...joint.parameters };
  const dofs = [...((joint.parameters.dofs as AssemblyJointValue[] | undefined) ?? [])];
  const idx = dofs.findIndex((d) => d.name === dofName);
  if (idx >= 0) dofs[idx] = { ...dofs[idx], value };
  else dofs.push({ ...template, value });
  joint.parameters.dofs = dofs;
  return next;
}

export interface JointDriveResult {
  achievedValue: number;
  stoppedAt: "target" | "limit" | "contact" | "unsolvable";
  solution: AssemblySolution;
}

/** Drive a single joint DOF smoothly from its current value to `targetValue` with limit clamping
 *  and optional stop-on-contact callback (`joint.drive`). */
export function driveJoint(
  job: AssemblyJobInput,
  jointId: string,
  dofName: string,
  targetValue: number,
  options?: { fromValue?: number; steps?: number; isInContact?: (solution: AssemblySolution) => boolean },
): JointDriveResult {
  const joint = job.joints.find((j) => j.id === jointId);
  if (!joint) throw new Error(`Joint "${jointId}" does not exist.`);
  const existing = ((joint.parameters?.dofs as AssemblyJointValue[] | undefined) ?? []).find((d) => d.name === dofName);
  const limitEntry = ((joint.parameters?.limits as AssemblyJointLimit[] | undefined) ?? []).find((l) => l.dof === dofName);
  const minVal = limitEntry?.min ?? existing?.min_value;
  const maxVal = limitEntry?.max ?? existing?.max_value;

  let clamped = targetValue;
  let hitLimit = false;
  if (minVal !== undefined && clamped < minVal) { clamped = minVal; hitLimit = true; }
  if (maxVal !== undefined && clamped > maxVal) { clamped = maxVal; hitLimit = true; }

  const start = options?.fromValue ?? existing?.value ?? 0;
  const steps = Math.max(1, Math.min(200, Math.round(options?.steps ?? 16)));
  let lastValid = solveAssemblyJob(withJointDof(job, jointId, dofName, start));
  let achieved = start;
  for (let i = 1; i <= steps; i++) {
    const val = start + ((clamped - start) * i) / steps;
    const sol = solveAssemblyJob(withJointDof(job, jointId, dofName, val, lastValid.instances));
    if (sol.status !== "ok") {
      return { achievedValue: achieved, stoppedAt: "unsolvable", solution: lastValid };
    }
    if (options?.isInContact?.(sol)) {
      return { achievedValue: achieved, stoppedAt: "contact", solution: lastValid };
    }
    lastValid = sol;
    achieved = val;
  }
  return { achievedValue: achieved, stoppedAt: hitLimit ? "limit" : "target", solution: lastValid };
}

export interface JointSweepSample {
  value: number;
  status: "ok" | "error";
  instances: SolvedInstance[];
}

/** Sweep a joint DOF across `[from, to]` in `steps` increments (`joint.sweep`). */
export function sweepJoint(
  job: AssemblyJobInput,
  jointId: string,
  dofName: string,
  from: number,
  to: number,
  steps = 10,
): { samples: JointSweepSample[]; okCount: number; failedCount: number } {
  const n = Math.max(2, Math.min(200, Math.round(steps)));
  const samples: JointSweepSample[] = [];
  let seed: SolvedInstance[] | undefined;
  let okCount = 0, failedCount = 0;
  for (let i = 0; i < n; i++) {
    const value = from + ((to - from) * i) / (n - 1);
    const sol = solveAssemblyJob(withJointDof(job, jointId, dofName, value, seed));
    if (sol.status === "ok") { seed = sol.instances; okCount++; }
    else failedCount++;
    samples.push({ value, status: sol.status, instances: sol.instances });
  }
  return { samples, okCount, failedCount };
}

/** Discover feasible kinematic limits of a joint DOF via stepping + binary search (`joint.find_limits`). */
export function findJointLimits(
  job: AssemblyJobInput,
  jointId: string,
  dofName: string,
  searchMin: number,
  searchMax: number,
  options?: { originValue?: number; coarseSteps?: number; precision?: number; isInContact?: (sol: AssemblySolution) => boolean },
): { minFeasible: number; maxFeasible: number } {
  const origin = options?.originValue ?? 0;
  const coarse = Math.max(4, options?.coarseSteps ?? 20);
  const prec = options?.precision ?? 0.05;
  const isOk = (val: number, seed?: SolvedInstance[]) => {
    const sol = solveAssemblyJob(withJointDof(job, jointId, dofName, val, seed));
    return sol.status === "ok" && !(options?.isInContact?.(sol)) ? sol : null;
  };
  const walk = (limitEnd: number): number => {
    let good = origin;
    let seed = isOk(origin)?.instances;
    if (!seed) return origin;
    let bad: number | undefined;
    for (let i = 1; i <= coarse; i++) {
      const v = origin + ((limitEnd - origin) * i) / coarse;
      const sol = isOk(v, seed);
      if (sol) { good = v; seed = sol.instances; }
      else { bad = v; break; }
    }
    if (bad === undefined) return good;
    let lo = good, hi = bad;
    for (let it = 0; it < 20 && Math.abs(hi - lo) > prec; it++) {
      const mid = (lo + hi) / 2;
      const sol = isOk(mid, seed);
      if (sol) { lo = mid; seed = sol.instances; }
      else hi = mid;
    }
    return lo;
  };
  return { minFeasible: walk(searchMin), maxFeasible: walk(searchMax) };
}
