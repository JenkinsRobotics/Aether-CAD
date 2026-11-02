import { evaluateExpression } from "./expressions/evaluate";
import { numeric, scalar } from "./expressions/values";
/** The field's display unit: `factor` is SI per display unit (mm = 0.001, deg = π/180). */
export interface DisplayUnit { family: "length" | "angle"; factor: number }
/** Numeric field calculations are read in the field's display unit. With a display
 * unit given, a typed unit (2.77 in, 30 deg) is converted to it, as other CAD apps do
 * (Jonathan, 2026-11-01); variables and text belong to document expressions. */
export function evaluateQuantityExpression(source: string, display?: DisplayUnit): number {
  if (!source.trim() || source.length > 512)
    throw Error("Enter a calculation of at most 512 characters.");
  try {
    const value = evaluateExpression(source, { allowUnits: Boolean(display), allowText: false });
    if (!display) return scalar(value);
    const q = numeric(value);
    if (q.lengthPower === 0 && q.anglePower === 0) return q.magnitudeSI;
    const matches = display.family === "length" ? q.lengthPower === 1 && q.anglePower === 0 : q.lengthPower === 0 && q.anglePower === 1;
    if (!matches) throw Error(display.family === "length" ? "Enter a length such as 25 mm or 1 in." : "Enter an angle such as 30 deg.");
    return q.magnitudeSI / display.factor;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid expression")
    )
      throw Error(
        "Enter numbers, pi, functions, parentheses and + − * / ^ operators.",
      );
    throw error;
  }
}
