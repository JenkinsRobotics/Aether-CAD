import { evaluateQuantityExpression, unitChoice } from "@aether/core/units";
import { documentUnits, subscribeDocumentUnits } from "../document-preferences";

/** UI conversion only. Solver values remain millimeters or degrees. Each owner
 * must dispose the binding before replacing the input or closing its panel. */
export function bindDimensionInput(
  input: HTMLInputElement,
  kind: () => string,
  label: (unit: string, format: (canonical: number) => string) => void,
) {
  const choice = () => {
    if (kind() === 'conic-rho') return {family:'scalar',unit:'ratio',toCanonical:1};
    const family = kind() === "angle" ? "angle" : "length";
    const unit = unitChoice(documentUnits(), family);
    return {
      ...unit,
      family,
      toCanonical: unit.factor / (family === "angle" ? Math.PI / 180 : 0.001),
    };
  };
  let current = choice();
  // A typed unit converts into the field's unit; conic rho stays a plain ratio.
  const display = () => current.family === "scalar" ? undefined : { family: current.family as "length" | "angle", factor: (current as { factor: number }).factor };
  // Shown to 10 significant digits so unit conversion never leaves float noise (1.56, not 1.5600000000000003).
  const format = (canonical: number) => String(Number((canonical / current.toCanonical).toPrecision(10)));
  const refresh = () => {
    const next = choice();
    if (
      current.family === next.family &&
      current.toCanonical !== next.toCanonical &&
      input.value.trim()
    ) {
      try {
        input.value = String(
          (evaluateQuantityExpression(input.value, display()) * current.toCanonical) /
            next.toCanonical,
        );
      } catch {
        // An incomplete calculation cannot be reinterpreted in another unit.
        input.value = "";
      }
    }
    current = next;
    input.title = `Value in ${current.unit}; a typed unit such as 1 in or 30 deg converts. Calculations such as 1/8, sqrt(25), or sin(pi/2) are supported. Numeric trigonometry uses radians.`;
    label(current.unit, format);
  };
  refresh();
  const dispose = subscribeDocumentUnits(refresh);
  return {
    read: () => evaluateQuantityExpression(input.value, display()) * current.toCanonical,
    write: (canonical: number) => {
      input.value = format(canonical);
    },
    refresh,
    dispose,
  };
}
