import type { FeatureEditor } from "./shared";
import { bodiesControls, bodiesLayout, bodiesValid } from "./surface";

/** Fair: a surface's interior control points relaxed, its border held. */
export const surfaceFairEditor: FeatureEditor = {
  type: "surface-fair",
  handles: false,
  controls(context) {
    const { field, feature } = context;
    return { ...bodiesControls(context), strength: field("Strength (0–1)", String(feature?.strength ?? 1)), tolerance: field("Largest move (mm, blank = none)", feature?.toleranceMillimeters === undefined ? "" : String(feature.toleranceMillimeters)) };
  },
  layout(context, controls) { bodiesLayout(context, controls, "Surface to fair", true); },
  validate(controls) {
    const s = Number(controls.strength.value);
    if (!(s > 0 && s <= 1)) return "Strength is more than 0 and at most 1.";
    if (controls.tolerance.value.trim() && !(Number(controls.tolerance.value) > 0)) return "The largest move must be positive.";
    return bodiesValid(controls, "surface body", 1);
  },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), strength: Number(values.strength), ...(values.tolerance?.trim() ? { toleranceMillimeters: Number(values.tolerance) } : {}) }; },
};
