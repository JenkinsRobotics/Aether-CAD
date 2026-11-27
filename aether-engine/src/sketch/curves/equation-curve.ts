import { evaluateExpression } from "../../expressions/evaluate";
import { numeric, quantity, type ExpressionValue } from "../../expressions/values";
import type { SketchContour, SketchPoint } from "../drawing";
import { fitSketchSpline } from "./fit-spline";

export interface EquationCurveRequest {
  mode: "parametric" | "explicit";
  /** Required when mode === "parametric"; expression in parameter #t (or #x). */
  xExpression?: string;
  /** Expression in #t (parametric) or #x (explicit), resolving to scalar or length mm. */
  yExpression: string;
  tMin: number;
  tMax: number;
  samples?: number;
  periodic?: boolean;
  construction?: boolean;
  variables?: ReadonlyMap<string, ExpressionValue>;
}

function evalScalarOrMm(expr: string, paramName: string, paramValue: number, variables?: ReadonlyMap<string, ExpressionValue>): number {
  const value = numeric(
    evaluateExpression(expr, {
      allowText: false,
      resolveVariable(name) {
        if (name === paramName) return quantity(paramValue, 0, 0);
        const found = variables?.get(name);
        if (found === undefined) throw new Error(`Unknown variable #${name} in equation curve.`);
        return found;
      },
    }),
  );
  // If expression returned a length quantity (e.g. `10 mm * cos(#t)`), convert SI meters to mm;
  // otherwise interpret dimensionless scalar directly as millimeters.
  const out = value.lengthPower === 1 ? value.magnitudeSI * 1000 : value.magnitudeSI;
  if (!Number.isFinite(out)) throw new Error("Equation curve evaluated to a non-finite coordinate.");
  return out;
}

/** Generate a smooth spline contour from a parametric `(x(t), y(t))` or explicit `y(x)` equation
 *  using Aether's dimensional expression engine (`sketch.equation_curve`). */
export function createEquationCurve(request: EquationCurveRequest): SketchContour {
  const { mode, tMin, tMax, periodic = false, construction = false, variables } = request;
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax <= tMin)
    throw new Error("Equation curve range requires finite tMin < tMax.");
  const samples = request.samples ?? 32;
  if (!Number.isInteger(samples) || samples < 2 || samples > 500)
    throw new Error("Equation curve samples must be an integer between 2 and 500.");
  if (mode === "parametric" && !request.xExpression?.trim())
    throw new Error("Parametric equation curve requires both xExpression and yExpression.");
  if (!request.yExpression?.trim())
    throw new Error("Equation curve requires yExpression.");

  const paramName = mode === "explicit" ? "x" : "t";
  const points: SketchPoint[] = [];
  const total = periodic ? samples : samples + 1;
  for (let i = 0; i < total; i++) {
    const u = periodic ? i / samples : i / samples;
    const t = tMin + (tMax - tMin) * u;
    const x = mode === "explicit" ? t : evalScalarOrMm(request.xExpression!, paramName, t, variables);
    const y = evalScalarOrMm(request.yExpression, paramName, t, variables);
    if (!points.length || Math.hypot(x - points[points.length - 1][0], y - points[points.length - 1][1]) > 1e-6) {
      points.push([x, y]);
    }
  }
  if (points.length < (periodic ? 3 : 2))
    throw new Error("Equation curve collapsed to fewer than the minimum distinct points.");
  const contour = fitSketchSpline(points, { closed: periodic });
  return construction ? { ...contour, construction: true } : contour;
}
