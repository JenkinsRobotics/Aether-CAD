/** 3D Sketch Constraint & Dimension Solver (SolidCraft's 3D wire solver equivalent).
 *  Solves point coordinates of 3D sketches with Levenberg-Marquardt damped least squares. */
export type V3 = [number, number, number];

export type Constraint3DKind =
  | "fix"
  | "coincident"
  | "along-axis"
  | "on-plane"
  | "distance"
  | "parallel"
  | "perpendicular"
  | "equal"
  | "angle"
  | "radius";

export interface Constraint3D {
  id: string;
  kind: Constraint3DKind;
  /** Point index or segment [startIdx, endIdx] / arc [startIdx, midIdx, endIdx]. */
  a: number | [number, number] | [number, number, number];
  b?: number | [number, number];
  axis?: "X" | "Y" | "Z";
  plane?: "XY" | "XZ" | "YZ";
  /** Target point for `fix`, or plane offset along normal for `on-plane`. */
  point?: V3;
  value?: number;
}

export interface Solve3DReport {
  points: V3[];
  degreesOfFreedom: number;
  maxResidual: number;
}

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }

/** Exact 3D circumcircle through three non-collinear 3D points. */
export function arc3dGeometry(p0: V3, p1: V3, p2: V3): { center: V3; radius: number; normal: V3; u: V3; v: V3; sweep: number } {
  const a = sub(p1, p0);
  const b = sub(p2, p0);
  const n = cross(a, b);
  const nLen = len(n);
  if (nLen < 1e-9) throw new Error("3D arc points must not be collinear.");
  const normal: V3 = [n[0] / nLen, n[1] / nLen, n[2] / nLen];
  const a2 = dot(a, a), b2 = dot(b, b);
  const aCrossB = n;
  const term1 = cross(aCrossB, a);
  const term2 = cross(b, aCrossB);
  const denom = 2 * nLen * nLen;
  const center: V3 = [
    p0[0] + (b2 * term1[0] + a2 * term2[0]) / denom,
    p0[1] + (b2 * term1[1] + a2 * term2[1]) / denom,
    p0[2] + (b2 * term1[2] + a2 * term2[2]) / denom,
  ];
  const r0 = sub(p0, center);
  const radius = len(r0);
  const u: V3 = [r0[0] / radius, r0[1] / radius, r0[2] / radius];
  const v = cross(normal, u);
  const ang = (p: V3) => {
    const d = sub(p, center);
    return Math.atan2(dot(d, v), dot(d, u));
  };
  const tau = 2 * Math.PI;
  const mod = (x: number) => ((x % tau) + tau) % tau;
  const aMid = mod(ang(p1));
  const aEnd = mod(ang(p2));
  const sweep = aMid <= aEnd ? aEnd : aEnd - tau;
  return { center, radius, normal, u, v, sweep };
}

function residual3D(pts: V3[], c: Constraint3D): number[] {
  const pt = (idx: unknown): V3 => {
    if (typeof idx !== "number" || !pts[idx]) throw new Error("3D constraint requires a valid point index.");
    return pts[idx];
  };
  const seg = (pair: unknown): [V3, V3] => {
    if (!Array.isArray(pair) || pair.length !== 2 || !pts[pair[0]] || !pts[pair[1]])
      throw new Error("3D constraint requires a valid [start, end] segment.");
    return [pts[pair[0]], pts[pair[1]]];
  };
  switch (c.kind) {
    case "fix": {
      const p = pt(c.a);
      if (!c.point || c.point.length !== 3 || !c.point.every(Number.isFinite))
        throw new Error("3D fix constraint requires a finite [x, y, z] target.");
      return [p[0] - c.point[0], p[1] - c.point[1], p[2] - c.point[2]];
    }
    case "coincident": {
      const p = pt(c.a), q = pt(c.b);
      return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    }
    case "along-axis": {
      const [p, q] = seg(c.a);
      const d = sub(q, p);
      if (c.axis === "X") return [d[1], d[2]];
      if (c.axis === "Y") return [d[0], d[2]];
      if (c.axis === "Z") return [d[0], d[1]];
      throw new Error("along-axis requires axis X, Y, or Z.");
    }
    case "on-plane": {
      const offset = c.value ?? 0;
      let idx: 0 | 1 | 2;
      if (c.plane === "XY") idx = 2;
      else if (c.plane === "XZ") idx = 1;
      else if (c.plane === "YZ") idx = 0;
      else throw new Error("on-plane requires plane XY, XZ, or YZ.");
      if (Array.isArray(c.a)) return c.a.map((i) => pt(i)[idx] - offset);
      return [pt(c.a)[idx] - offset];
    }
    case "distance": {
      const [p, q] = Array.isArray(c.a) ? seg(c.a) : [pt(c.a), pt(c.b)];
      if (!Number.isFinite(c.value) || c.value! <= 0) throw new Error("3D distance must be positive.");
      return [len(sub(q, p)) - c.value!];
    }
    case "equal": {
      const [a0, a1] = seg(c.a), [b0, b1] = seg(c.b);
      return [len(sub(a1, a0)) - len(sub(b1, b0))];
    }
    case "parallel": {
      const [a0, a1] = seg(c.a), [b0, b1] = seg(c.b);
      const u = sub(a1, a0), v = sub(b1, b0);
      const s = Math.max(len(u) * len(v), 1e-10);
      const cr = cross(u, v);
      return [cr[0] / s, cr[1] / s, cr[2] / s];
    }
    case "perpendicular": {
      const [a0, a1] = seg(c.a), [b0, b1] = seg(c.b);
      const u = sub(a1, a0), v = sub(b1, b0);
      const s = Math.max(len(u) * len(v), 1e-10);
      return [dot(u, v) / s];
    }
    case "angle": {
      const [a0, a1] = seg(c.a), [b0, b1] = seg(c.b);
      if (!Number.isFinite(c.value) || c.value! < 0 || c.value! > 180)
        throw new Error("3D angle must be between 0 and 180 degrees.");
      const u = sub(a1, a0), v = sub(b1, b0);
      const s = Math.max(len(u) * len(v), 1e-10);
      return [dot(u, v) / s - Math.cos((c.value! * Math.PI) / 180)];
    }
    case "radius": {
      if (!Array.isArray(c.a) || c.a.length !== 3) throw new Error("3D radius requires a 3-point arc [i0, i1, i2].");
      if (!Number.isFinite(c.value) || c.value! <= 0) throw new Error("3D radius must be positive.");
      const g = arc3dGeometry(pt(c.a[0]), pt(c.a[1]), pt(c.a[2]));
      return [g.radius - c.value!];
    }
  }
}

function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    const q = a[i][i];
    if (Math.abs(q) < 1e-18) throw new Error("3D constraint system is singular.");
    for (let k = i; k < n; k++) a[i][k] /= q;
    b[i] /= q;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const f = a[j][i];
      for (let k = i; k < n; k++) a[j][k] -= f * a[i][k];
      b[j] -= f * b[i];
    }
  }
  return b;
}

/** Solve 3D sketch constraints via Levenberg-Marquardt and report remaining 3D DOF. */
export function solve3DConstraints(sourcePoints: V3[], constraints: Constraint3D[]): Solve3DReport {
  const pts = sourcePoints.map((p) => [...p] as V3);
  if (!constraints.length) return { points: pts, degreesOfFreedom: pts.length * 3, maxResidual: 0 };
  const residual = () => constraints.flatMap((c) => residual3D(pts, c));
  const norm = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  const nVars = pts.length * 3;
  const getVar = (k: number) => pts[(k / 3) | 0][k % 3];
  const setVar = (k: number, v: number) => { pts[(k / 3) | 0][k % 3] = v; };

  let damping = 1e-5;
  for (let iter = 0; iter < 120; iter++) {
    const r = residual();
    if (!r.every(Number.isFinite)) throw new Error("Invalid 3D constraint geometry.");
    const maxR = Math.max(...r.map(Math.abs), 0);
    if (maxR < 1e-7) {
      // Estimate Jacobian rank for 3D DOF.
      const rows = computeJacobianRows(pts, residual, nVars, r);
      const rank = matrixRank(rows);
      return { points: pts, degreesOfFreedom: Math.max(0, nVars - rank), maxResidual: maxR };
    }
    const before = Array.from({ length: nVars }, (_, k) => getVar(k));
    const cols: number[][] = [];
    for (let k = 0; k < nVars; k++) {
      const h = 1e-5 * Math.max(1, Math.abs(before[k]));
      setVar(k, before[k] + h);
      const plus = residual();
      setVar(k, before[k]);
      cols.push(plus.map((p, i) => (p - r[i]) / h));
    }
    const m = r.length;
    const jjt: number[][] = Array.from({ length: m }, (_, i) =>
      Array.from({ length: m }, (_, j) => cols.reduce((s, col) => s + col[i] * col[j], 0) + (i === j ? damping : 0)),
    );
    const step = solveLinear(jjt, r.map((v) => -v));
    for (let k = 0; k < nVars; k++) {
      let delta = 0;
      for (let i = 0; i < m; i++) delta += cols[k][i] * step[i];
      setVar(k, before[k] + delta);
    }
    if (norm(residual()) < norm(r)) damping = Math.max(1e-10, damping * 0.3);
    else {
      for (let k = 0; k < nVars; k++) setVar(k, before[k]);
      damping *= 10;
    }
  }
  throw new Error("3D sketch constraints conflict or cannot converge.");
}

function computeJacobianRows(pts: V3[], residual: () => number[], nVars: number, r0: number[]): number[][] {
  const cols: number[][] = [];
  for (let k = 0; k < nVars; k++) {
    const i = (k / 3) | 0, j = k % 3;
    const orig = pts[i][j], h = 1e-5 * Math.max(1, Math.abs(orig));
    pts[i][j] = orig + h;
    const plus = residual();
    pts[i][j] = orig - h;
    const minus = residual();
    pts[i][j] = orig;
    cols.push(plus.map((p, idx) => (p - minus[idx]) / (2 * h)));
  }
  return r0.map((_, row) => cols.map((col) => col[row]));
}

function matrixRank(input: number[][]): number {
  const rows = input.filter((r) => Math.hypot(...r) > 1e-8).map((r) => { const n = Math.hypot(...r); return r.map((x) => x / n); });
  const width = rows[0]?.length ?? 0;
  let rank = 0;
  for (let col = 0; col < width && rank < rows.length; col++) {
    let pivot = rank;
    for (let i = rank + 1; i < rows.length; i++) if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col])) pivot = i;
    if (Math.abs(rows[pivot][col]) < 1e-6) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const s = rows[rank][col];
    for (let k = col; k < width; k++) rows[rank][k] /= s;
    for (let i = rank + 1; i < rows.length; i++) {
      const f = rows[i][col];
      for (let k = col; k < width; k++) rows[i][k] -= f * rows[rank][k];
    }
    rank++;
  }
  return rank;
}
