import { evaluateExpression } from "../expressions/evaluate";
import { numeric, type ExpressionValue } from "../expressions/values";
import type { PartDocument, PartFeature } from "./part-document";

/** Map numeric 3D feature property names to their expected physical unit family. */
function featureFieldUnit(key: string): "length" | "angle" | "scalar" | undefined {
  if (key.endsWith("Millimeters")) return "length";
  if (key.endsWith("Degrees")) return "angle";
  if (key === "count" || key === "turns" || key === "starts" || key === "kFactor" || key === "endScale" || key === "strength") return "scalar";
  return undefined;
}

/** Evaluate a single feature expression against document variables into canonical mm / deg / scalar. */
export function evaluateFeatureExpression(
  key: string,
  expression: string,
  variables: ReadonlyMap<string, ExpressionValue>,
): number {
  const family = featureFieldUnit(key);
  if (!family) throw new Error(`Field "${key}" does not support parametric expressions.`);
  const val = numeric(
    evaluateExpression(expression, {
      allowText: false,
      resolveVariable(name) {
        const found = variables.get(name);
        if (found === undefined) throw new Error(`Unknown variable #${name}.`);
        return found;
      },
    }),
  );
  if (family === "length") {
    if (val.lengthPower !== 1 || val.anglePower !== 0)
      throw new Error(`Expression for ${key} must resolve to a length (e.g. mm).`);
    return val.magnitudeSI * 1000;
  }
  if (family === "angle") {
    if (val.lengthPower !== 0 || val.anglePower !== 1)
      throw new Error(`Expression for ${key} must resolve to an angle (e.g. deg).`);
    return (val.magnitudeSI * 180) / Math.PI;
  }
  if (val.lengthPower !== 0 || val.anglePower !== 0)
    throw new Error(`Expression for ${key} must resolve to a dimensionless number.`);
  return val.magnitudeSI;
}

/** Apply `feature.expressions` maps across all 3D features in a PartDocument, writing
 *  canonical numeric values so downstream OCCT evaluation uses the live parameter values. */
export function applyFeatureExpressions(
  doc: PartDocument,
  variables: ReadonlyMap<string, ExpressionValue>,
): void {
  for (const feature of doc.features) {
    const expressions = (feature as PartFeature & { expressions?: Record<string, string> }).expressions;
    if (!expressions || typeof expressions !== "object") continue;
    for (const [key, expr] of Object.entries(expressions)) {
      if (typeof expr !== "string" || !expr.trim()) continue;
      const computed = evaluateFeatureExpression(key, expr, variables);
      (feature as unknown as Record<string, unknown>)[key] = key === "count" || key === "starts" ? Math.round(computed) : computed;
    }
  }
}
