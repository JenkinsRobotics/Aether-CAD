import type { FeatureEditor } from "./shared";
import { bodiesControls, bodiesLayout, bodiesValid } from "./surface";
import { parsePoints3D } from "./curve3d";

/** Trim: a surface cut at a plane, keeping the side a point is on. */
export const surfaceTrimEditor: FeatureEditor = {
  type: "surface-trim",
  handles: false,
  controls(context) {
    const { field, reference, feature } = context, plane = feature?.plane;
    return {
      ...bodiesControls(context),
      planeSource: field("Plane source", plane?.kind === "feature" ? "feature" : "principal", ["principal", "feature"]),
      plane: field("Plane", plane?.kind === "principal" ? plane.plane : "YZ", ["XY", "XZ", "YZ"]),
      offset: field("Plane offset (mm)", String(plane?.kind === "principal" ? plane.offsetMillimeters : 0)),
      planeFeature: reference("Plane feature", ["plane"], plane?.kind === "feature" ? plane.featureId : undefined),
      keep: field("Keep point (x y z) mm", feature ? feature.keepPointMillimeters.join(" ") : ""),
    };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Surface to trim", true);
    const row = (key: string) => controls[key].closest<HTMLElement>(".aui-feature-row") ?? controls[key].parentElement;
    const sync = () => { const principal = controls.planeSource.value === "principal"; for (const key of ["plane", "offset"]) { const r = row(key); if (r) r.hidden = !principal; } const r = row("planeFeature"); if (r) r.hidden = principal; };
    controls.planeSource.addEventListener("change", sync); sync();
  },
  validate(controls) {
    try { if (parsePoints3D(controls.keep.value).length !== 1) return "Enter one keep point on the side to keep."; } catch (error) { return (error as Error).message; }
    if (controls.planeSource.value === "feature" && !controls.planeFeature.value) return "Choose the plane feature to trim with.";
    if (controls.planeSource.value === "principal" && !Number.isFinite(Number(controls.offset.value))) return "Enter a finite plane offset.";
    return bodiesValid(controls, "surface body", 1);
  },
  serialize(values) {
    return { bodyIds: JSON.parse(values.bodies), keepPointMillimeters: parsePoints3D(values.keep)[0], plane: values.planeSource === "feature" ? { kind: "feature", featureId: values.planeFeature } : { kind: "principal", plane: values.plane, offsetMillimeters: Number(values.offset) } };
  },
};
