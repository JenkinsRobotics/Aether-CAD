/** Assemblies solved in-process: rigid instances, mates as constraints on the
 *  relative pose of two connector frames, Levenberg–Marquardt on the free
 *  poses. Same job and answer as the FreeCAD service (`aether_freecad/
 *  assembly.py`): grounded instances stay, nothing grounded holds the first
 *  one and says so, every mate is checked after the solve as FreeCAD's
 *  acceptance did (`assembly_residuals.py`), and a partial solve publishes no
 *  placements. */
import type { AssemblyDiagnostic, AssemblyJobInput, AssemblyJoint, AssemblyJointEnd, AssemblyMateKind, AssemblySolution } from "../contracts/assembly";

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

/** The joint coordinate system of one mate end, in the world. */
function frameOf(pose: Pose, end: AssemblyJointEnd): Frame {
  const local: V3 = end.placement_mm ? [...end.placement_mm] as V3 : [0, 0, 0];
  const rot: Q = end.rotation ? qnorm([...end.rotation] as Q) : [0, 0, 0, 1];
  const q = qmul(pose.q, rot);
  return { o: add(pose.p, rotate(pose.q, local)), x: rotate(q, [1, 0, 0]), y: rotate(q, [0, 1, 0]), z: rotate(q, [0, 0, 1]) };
}

/** Orientation residuals are unit-vector components; this many millimetres
 *  per radian puts them on the scale of the position residuals. */
const ORIENTATION_SCALE = 100;

/** The mates the in-process solver can solve: joints the frames define alone.
 *  Rack and pinion, screw, gears and belt couple other joints' motion. */
export const solvableMateKinds: readonly AssemblyMateKind[] = ["fastened", "revolute", "cylindrical", "prismatic", "ball", "distance", "parallel", "perpendicular", "angle", "planar", "pin_slot"];

/** The residual vector of one mate between two world frames (zero when satisfied). */
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
    joints.push(joint);
  }
  const free = [...poses.keys()].filter((id) => !grounded.has(id));
  const residuals = (current: Map<string, Pose>): number[] =>
    joints.flatMap((joint) => jointResiduals(joint.kind, frameOf(current.get(joint.a.instance)!, joint.a), frameOf(current.get(joint.b.instance)!, joint.b), joint.parameters));
  const errorsBefore = diagnostics.filter((d) => d.severity === "error");
  if (!errorsBefore.length && free.length && joints.length) {
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
      const values = jointResiduals(joint.kind, frameOf(poses.get(joint.a.instance)!, joint.a), frameOf(poses.get(joint.b.instance)!, joint.b), joint.parameters);
      const worst = Math.max(0, ...values.map(Math.abs));
      if (!Number.isFinite(worst) || worst > 1e-4) diagnostics.push({ feature_id: joint.id, severity: "error", message: `Mate is not satisfied after solving: residual ${worst.toExponential(3)} exceeds 1e-4. Check conflicting mates or connector references.` });
    }
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
