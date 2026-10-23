import type { FeatureEditor, FeatureEditorContext } from "./shared";

const kinds = ["line", "spline", "point"] as const;
const format = (points: readonly (readonly number[])[]) => points.map((p) => p.join(" ")).join("; ");
/** "x y z; x y z" (commas allowed) into points. */
export function parsePoints3D(text: string): [number, number, number][] {
  return text.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const parts = s.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) throw new Error(`"${s}" is not x y z.`);
    return parts as [number, number, number];
  });
}
/** 3D sketch: typed world points as lines, a spline or a point. The viewport draws
 *  it like a finished sketch; sweeps, pipes and path patterns take it as a path. */
export const curve3dEditor: FeatureEditor = {
  type: "curve3d",
  handles: false,
  controls({ field, feature }: FeatureEditorContext) {
    return {
      kind: field("Kind", feature?.kind ?? "line", [...kinds]),
      points: field("Points (x y z; x y z …) mm", feature ? format(feature.pointsMillimeters) : "0 0 0; 50 0 0; 50 50 20"),
    };
  },
  validate(controls) {
    try {
      const points = parsePoints3D(controls.points.value);
      if (controls.kind.value === "point") return points.length === 1 ? null : "A 3D point is one point.";
      return points.length >= 2 ? null : "Enter two or more points.";
    } catch (error) { return (error as Error).message; }
  },
  serialize(values) {
    return { kind: values.kind, pointsMillimeters: parsePoints3D(values.points) };
  },
};
