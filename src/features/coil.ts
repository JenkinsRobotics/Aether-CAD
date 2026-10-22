import { bodyAndOperationTabs, type FeatureEditor, type FeatureEditorContext } from "./shared";

const operationValues = ["new", "add", "cut"] as const;

/** Coil: a round wire along a helix about a principal axis. */
export const coilEditor: FeatureEditor = {
  type: "coil",
  controls({ field, feature }: FeatureEditorContext) {
    return {
      radius: field("Coil radius (mm)", String(feature?.radiusMillimeters ?? 10)),
      pitch: field("Pitch (mm)", String(feature?.pitchMillimeters ?? 5)),
      turns: field("Turns", String(feature?.turns ?? 3)),
      wire: field("Wire diameter (mm)", String(feature?.wireDiameterMillimeters ?? 2)),
      axis: field("Axis", feature?.axis ?? "Z", ["X", "Y", "Z"]),
      hand: field("Hand", feature?.leftHand ? "left" : "right", ["right", "left"]),
      centerX: field("Center X (mm)", String(feature?.centerMillimeters?.[0] ?? 0)),
      centerY: field("Center Y (mm)", String(feature?.centerMillimeters?.[1] ?? 0)),
      centerZ: field("Center Z (mm)", String(feature?.centerMillimeters?.[2] ?? 0)),
      operation: field("Operation", feature?.operation ?? "new", [...operationValues]),
    };
  },
  layout({ win, form }, controls) { bodyAndOperationTabs(win, form, controls.operation, operationValues); },
  validate(controls) {
    const r = Number(controls.radius.value), p = Number(controls.pitch.value), n = Number(controls.turns.value), w = Number(controls.wire.value);
    if (!(r > 0 && p > 0 && n > 0 && w > 0)) return "Enter positive radius, pitch, turns and wire diameter.";
    if (w >= p) return "The wire diameter must be less than the pitch.";
    if (w / 2 >= r) return "The wire must be thinner than the coil radius.";
    return null;
  },
  serialize(values) {
    return { radiusMillimeters: Number(values.radius), pitchMillimeters: Number(values.pitch), turns: Number(values.turns), wireDiameterMillimeters: Number(values.wire), axis: values.axis, ...(values.hand === "left" ? { leftHand: true } : {}),
      centerMillimeters: [Number(values.centerX), Number(values.centerY), Number(values.centerZ)], operation: values.operation };
  },
};
