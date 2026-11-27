import { validateDimensionExpression } from "./dimension-expressions";
import { conicCoordinates } from '../reference/conic-constraints';
import { textSimilarityCoordinates } from "./text-coordinates";
import { ellipseLocusCoordinates } from "./ellipse-locus-coordinates";
import { contactParameterCoordinates } from "./contact-parameters";
import { dimensionDriver } from "./dimension-links";
import type { SketchDrawing, SketchPoint } from "../drawing";
import type { DrawingConstraint, SketchEntityRef } from "./types";
import { constraintResiduals } from "./residuals";
import { captureDistanceSides } from "./distance-side";
import { solveSavedPierceConstraints } from '../reference/pierce-constraints';
import { sketchEntityPoint } from "./entities";

/** SPIKE (2026-09-12): see solver/planegcs-spike.ts. Delete with the spike. */
type SolverComparisonHost = {
  __aetherSolverComparison?: (
    source: SketchDrawing,
    options: { fixedContours?: ReadonlySet<number> },
    outcome: SketchDrawing | Error,
  ) => void;
};

interface SolverVar {
  get: () => number;
  set: (v: number) => void;
  differenceStep?: () => number;
}

const MAX_CONSTRAINTS = 4096;
const MAX_COMPONENT_VARS = 2048;

function linearSolve(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    const q = a[i][i];
    if (Math.abs(q) < 1e-18)
      throw new Error("Constraint system is singular.");
    for (let k = i; k < n; k++) a[i][k] /= q;
    b[i] /= q;
    for (let j = 0; j < n; j++)
      if (j !== i) {
        const f = a[j][i];
        for (let k = i; k < n; k++) a[j][k] -= f * a[i][k];
        b[j] -= f * b[i];
      }
  }
  return b;
}

function collectContourVars(
  d: SketchDrawing,
  usedContours: ReadonlySet<number>,
  fixedContours: ReadonlySet<number> | undefined,
  textGroups: ReturnType<typeof textSimilarityCoordinates>,
  linkedEllipses: ReturnType<typeof ellipseLocusCoordinates>,
  parameters: SolverVar[],
  includeGlobalGroups: boolean,
): SolverVar[] {
  const vars: SolverVar[] = [];
  const addPoint = (p: SketchPoint, alias?: SketchPoint) => {
    for (let k = 0; k < 2; k++)
      vars.push({
        get: () => p[k],
        set: (v) => {
          p[k] = v;
          if (alias) alias[k] = v;
        },
      });
  };
  if (includeGlobalGroups) {
    vars.push(...textGroups.coordinates);
    vars.push(...linkedEllipses.coordinates);
  }
  d.contours.forEach((c, i) => {
    if (!usedContours.has(i) || fixedContours?.has(i) || linkedEllipses.covered.has(i) || textGroups.covered.has(i)) return;
    if (c.type === "circle") {
      addPoint(c.center);
      vars.push({ get: () => c.radius, set: (v) => (c.radius = v) });
    } else {
      const last = c.segments.at(-1);
      const closed =
        last &&
        Math.hypot(last.end[0] - c.start[0], last.end[1] - c.start[1]) < 1e-6;
      addPoint(c.start, closed ? last.end : undefined);
      c.segments.forEach((s, j) => {
        if (!(closed && j === c.segments.length - 1)) addPoint(s.end);
        if (s.type === "ellipse") {
          for (const key of ["radiusX", "radiusY"] as const)
            vars.push({ get: () => Math.log(s[key]), set: (v) => { s[key] = Math.exp(v); } });
          vars.push({ get: () => (s.rotationDegrees * Math.PI) / 180, set: (v) => { s.rotationDegrees = (v * 180) / Math.PI; } });
        }
        if (s.type === "arc") addPoint(s.middle);
        if (s.type === "bezier") s.controls.forEach((p) => addPoint(p));
        if (s.type === "conic") vars.push(...conicCoordinates(s));
      });
    }
  });
  if (includeGlobalGroups) vars.push(...parameters);
  return vars;
}

function constraintContours(c: DrawingConstraint): number[] {
  const list: number[] = [];
  if (c.a.contour >= 0) list.push(c.a.contour);
  if (c.b && c.b.contour >= 0) list.push(c.b.contour);
  if (c.axis && c.axis.contour >= 0) list.push(c.axis.contour);
  return list;
}

/** Partition active constraints into independent connected components via union-find. */
function partitionConstraints(
  _d: SketchDrawing,
  constraints: DrawingConstraint[],
  globalCoupledContours: ReadonlySet<number>,
): { contours: Set<number>; constraints: DrawingConstraint[]; includesGlobal: boolean }[] {
  const n = constraints.length;
  if (n <= 1) {
    const contours = new Set<number>();
    for (const c of constraints) for (const idx of constraintContours(c)) contours.add(idx);
    return [{ contours, constraints, includesGlobal: true }];
  }
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const byContour = new Map<number, number>();
  const byId = new Map<string, number>();
  const byPatternGroup = new Map<string, number>();
  let firstGlobal = -1;
  constraints.forEach((c, i) => byId.set(c.id, i));
  constraints.forEach((c, i) => {
    const contours = constraintContours(c);
    let touchesGlobal = c.a.sliding || c.b?.sliding || false;
    for (const idx of contours) {
      if (globalCoupledContours.has(idx)) touchesGlobal = true;
      const prev = byContour.get(idx);
      if (prev !== undefined) union(prev, i);
      else byContour.set(idx, i);
    }
    if (c.valueFrom !== undefined) {
      const driverIdx = byId.get(c.valueFrom);
      if (driverIdx !== undefined) union(driverIdx, i);
    }
    if (c.patternGroup !== undefined) {
      const prev = byPatternGroup.get(c.patternGroup);
      if (prev !== undefined) union(prev, i);
      else byPatternGroup.set(c.patternGroup, i);
    }
    if (touchesGlobal) {
      if (firstGlobal >= 0) union(firstGlobal, i);
      else firstGlobal = i;
    }
  });
  const groups = new Map<number, { contours: Set<number>; constraints: DrawingConstraint[]; includesGlobal: boolean }>();
  constraints.forEach((c, i) => {
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = { contours: new Set(), constraints: [], includesGlobal: firstGlobal >= 0 && find(firstGlobal) === root };
      groups.set(root, g);
    }
    g.constraints.push(c);
    for (const idx of constraintContours(c)) g.contours.add(idx);
  });
  if (firstGlobal < 0 && groups.size > 0) {
    // No constraint touched global coupled contours; still safe to keep includesGlobal=false
    // because text/ellipse/contact vars aren't referenced by any constraint.
  }
  return [...groups.values()];
}

function solveComponentLM(
  vars: SolverVar[],
  residual: () => number[],
  maxIterations = 100,
): boolean {
  const norm = (r: number[]) => r.reduce((n, v) => n + v * v, 0);
  let damping = 1e-5;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const r = residual();
    if (!r.every(Number.isFinite))
      throw new Error("Invalid constraint geometry.");
    if (!r.length || Math.max(...r.map(Math.abs)) < 1e-7) return true;
    const before = vars.map((v) => v.get());
    const columns = vars.map((v, j) => {
      const h = v.differenceStep?.() ?? 1e-5 * Math.max(1, Math.abs(before[j]));
      v.set(before[j] + h);
      const plus = residual();
      v.set(before[j]);
      return plus.map((p, i) => (p - r[i]) / h);
    });
    const matrix = r.map((_, i) =>
      r.map(
        (_, j) =>
          columns.reduce((sum, c) => sum + c[i] * c[j], 0) +
          (i === j ? damping : 0),
      ),
    );
    const step = linearSolve(
      matrix,
      r.map((v) => -v),
    );
    vars.forEach((v, j) =>
      v.set(before[j] + columns[j].reduce((sum, c, i) => sum + c * step[i], 0)),
    );
    if (norm(residual()) < norm(r)) {
      damping = Math.max(1e-10, damping * 0.3);
    } else {
      vars.forEach((v, j) => v.set(before[j]));
      damping *= 10;
    }
  }
  return false;
}

/** Damped least-squares solve. Never mutates input or silently accepts conflicts. */
export function solveDrawingConstraints(source: SketchDrawing, options: { fixedContours?: ReadonlySet<number> } = {}): SketchDrawing {
  if (source.constraints?.some((c) => c.kind === 'pierce')) return solveSavedPierceConstraints(source, options);
  const compare = (globalThis as SolverComparisonHost).__aetherSolverComparison;
  if (!compare) return solveDrawingConstraintsCore(source, options);
  const given = structuredClone(source);
  try {
    const solved = solveDrawingConstraintsCore(source, options);
    compare(given, options, solved);
    return solved;
  } catch (error) {
    compare(given, options, error as Error);
    throw error;
  }
}

function solveDrawingConstraintsCore(source: SketchDrawing, options: { fixedContours?: ReadonlySet<number> } = {}): SketchDrawing {
  const d = structuredClone(source),
    constraints = d.constraints ?? [];
  const parameters = contactParameterCoordinates(d);
  if (!constraints.length) return d;
  if (constraints.length > MAX_CONSTRAINTS)
    throw new Error(`This sketch supports up to ${MAX_CONSTRAINTS} constraints.`);
  if (new Set(constraints.map((c) => c.id)).size !== constraints.length)
    throw new Error("Duplicate constraint IDs.");
  captureDistanceSides(d);
  for (const c of constraints) validateDimensionExpression(c);
  for (const c of constraints)
    if (c.valueFrom !== undefined || c.valueSign !== undefined || c.valueScale !== undefined || c.valueOffset !== undefined)
      dimensionDriver(d, c);
  const initial = constraints.flatMap((c) => constraintResiduals(d, c));
  if (!initial.every(Number.isFinite)) throw new Error("Invalid constraint geometry.");
  if (!initial.length || Math.max(...initial.map(Math.abs)) < 1e-7) return d;

  const activeConstraints = constraints.filter((c) => !c.reference);
  const usedAll = new Set(activeConstraints.flatMap(constraintContours));
  const textGroups = textSimilarityCoordinates(d, { fixed: options.fixedContours, used: usedAll });
  const linkedEllipses = ellipseLocusCoordinates(d, options.fixedContours);
  const globalCoupled = new Set<number>([...textGroups.covered, ...linkedEllipses.covered]);
  const components = partitionConstraints(d, activeConstraints, globalCoupled);

  for (const component of components) {
    const compInitial = component.constraints.flatMap((c) => constraintResiduals(d, c));
    if (!compInitial.length || Math.max(...compInitial.map(Math.abs)) < 1e-7) continue;
    const vars = collectContourVars(
      d,
      component.contours,
      options.fixedContours,
      textGroups,
      linkedEllipses,
      parameters,
      component.includesGlobal,
    );
    if (vars.length > MAX_COMPONENT_VARS)
      throw new Error(`Too many constrained sketch coordinates in one component (maximum ${MAX_COMPONENT_VARS}).`);
    const ok = solveComponentLM(vars, () => component.constraints.flatMap((c) => constraintResiduals(d, c)));
    if (!ok) {
      throw new Error("Constraints conflict or cannot converge. No geometry was changed.");
    }
  }
  // Verify reference measurements remain finite after solve.
  for (const c of constraints) if (c.reference) constraintResiduals(d, c);
  return textGroups.finish();
}

/** Feasible-manifold drag solver: pulls `softTargets` toward cursor positions with small
 *  weight while satisfying all existing sketch constraints exactly (`< 1e-7`). */
export function solveConstrainedSoftTargets(
  source: SketchDrawing,
  softTargets: { ref: SketchEntityRef; target: SketchPoint; weight?: number }[],
  options: { fixedContours?: ReadonlySet<number> } = {},
): SketchDrawing {
  const d = structuredClone(source);
  const constraints = d.constraints ?? [];
  if (!softTargets.length) return d;
  if (constraints.some((c) => c.kind === "pierce")) {
    throw new Error("Soft manifold drag defers pierce constraints.");
  }
  const parameters = contactParameterCoordinates(d);
  captureDistanceSides(d);
  const activeConstraints = constraints.filter((c) => !c.reference);
  const used = new Set<number>([
    ...activeConstraints.flatMap(constraintContours),
    ...softTargets.map((t) => t.ref.contour).filter((c) => c >= 0),
  ]);
  const textGroups = textSimilarityCoordinates(d, { fixed: options.fixedContours, used });
  const linkedEllipses = ellipseLocusCoordinates(d, options.fixedContours);
  const vars = collectContourVars(d, used, options.fixedContours, textGroups, linkedEllipses, parameters, true);
  if (!vars.length || vars.length > MAX_COMPONENT_VARS) return d;

  const norm = (r: number[]) => r.reduce((n, v) => n + v * v, 0);
  const combinedResidual = () => {
    const hard = activeConstraints.flatMap((c) => constraintResiduals(d, c));
    const soft: number[] = [];
    for (const t of softTargets) {
      const p = sketchEntityPoint(d, t.ref);
      if (!p) continue;
      const w = t.weight ?? 0.05;
      soft.push(w * (p[0] - t.target[0]), w * (p[1] - t.target[1]));
    }
    return [...hard, ...soft];
  };

  let damping = 1e-4;
  for (let iteration = 0; iteration < 35; iteration++) {
    const r = combinedResidual();
    if (!r.every(Number.isFinite)) break;
    const before = vars.map((v) => v.get());
    const columns = vars.map((v, j) => {
      const h = v.differenceStep?.() ?? 1e-5 * Math.max(1, Math.abs(before[j]));
      v.set(before[j] + h);
      const plus = combinedResidual();
      v.set(before[j]);
      return plus.map((p, i) => (p - r[i]) / h);
    });
    // Solve normal equations (J^T J + lambda I) dx = -J^T r in variable space
    // so over-determined soft targets never make the matrix singular.
    const m = vars.length;
    const jtj: number[][] = Array.from({ length: m }, () => Array(m).fill(0));
    const jtr: number[] = Array(m).fill(0);
    for (let i = 0; i < m; i++) {
      const ci = columns[i];
      let dotR = 0;
      for (let k = 0; k < r.length; k++) dotR += ci[k] * r[k];
      jtr[i] = -dotR;
      for (let j = i; j < m; j++) {
        const cj = columns[j];
        let dot = 0;
        for (let k = 0; k < r.length; k++) dot += ci[k] * cj[k];
        jtj[i][j] = dot + (i === j ? damping : 0);
        jtj[j][i] = jtj[i][j];
      }
    }
    let dx: number[];
    try {
      dx = linearSolve(jtj, jtr);
    } catch {
      damping *= 10;
      continue;
    }
    const maxStep = Math.max(...dx.map(Math.abs), 0);
    if (maxStep < 1e-7) break;
    vars.forEach((v, j) => v.set(before[j] + dx[j]));
    if (norm(combinedResidual()) < norm(r)) {
      damping = Math.max(1e-8, damping * 0.4);
    } else {
      vars.forEach((v, j) => v.set(before[j]));
      damping *= 10;
    }
  }
  const finished = textGroups.finish();
  const polished = constraints.length ? solveDrawingConstraintsCore(finished, options) : finished;
  // Snap explicitly fixed points bit-exact to their target so numerical polish noise never drifts them.
  for (const c of polished.constraints ?? []) {
    if (c.kind === "fix" && c.point && !c.fixedGeometry) {
      const p = sketchEntityPoint(polished, c.a);
      if (p && Math.hypot(p[0] - c.point[0], p[1] - c.point[1]) < 1e-6) {
        p[0] = c.point[0];
        p[1] = c.point[1];
      }
    }
  }
  return polished;
}
