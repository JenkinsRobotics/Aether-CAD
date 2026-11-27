import { availableBodies } from "@aether/core/document";
import type { FeatureEditor } from "./shared";
import { bodiesControls, bodiesLayout, bodiesValid } from "./surface";
import { parsePoints3D } from "./curve3d";

/** Trim: a surface cut at a plane or another surface/solid body, keeping the side a point is on. */
export const surfaceTrimEditor: FeatureEditor = {
  type: "surface-trim",
  handles: false,
  controls(context) {
    const { field, reference, feature, doc } = context, plane = feature?.plane;
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const allBodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const toolBody = field("Trimming body", feature?.toolBodyId ?? allBodies[0]?.id ?? "", allBodies.map((b) => b.id));
    Array.from(toolBody.children).forEach((o, i) => (o.textContent = allBodies[i].name));
    const source = feature?.toolBodyId ? "body" : plane?.kind === "feature" ? "feature" : "principal";
    return {
      ...bodiesControls(context),
      planeSource: field("Trim with", source, ["principal", "feature", "body"]),
      plane: field("Plane", plane?.kind === "principal" ? plane.plane : "YZ", ["XY", "XZ", "YZ"]),
      offset: field("Plane offset (mm)", String(plane?.kind === "principal" ? plane.offsetMillimeters : 0)),
      planeFeature: reference("Plane feature", ["plane"], plane?.kind === "feature" ? plane.featureId : undefined),
      toolBody,
      keep: field("Keep point (x y z) mm", feature ? feature.keepPointMillimeters.join(" ") : ""),
    };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Surface to trim", true);
    const row = (key: string) => controls[key].closest<HTMLElement>(".aui-feature-row") ?? controls[key].parentElement;
    const sync = () => {
      const mode = controls.planeSource.value;
      for (const key of ["plane", "offset"]) { const r = row(key); if (r) r.hidden = mode !== "principal"; }
      const rf = row("planeFeature"); if (rf) rf.hidden = mode !== "feature";
      const rb = row("toolBody"); if (rb) rb.hidden = mode !== "body";
    };
    controls.planeSource.addEventListener("change", sync); sync();
  },
  validate(controls) {
    try { if (parsePoints3D(controls.keep.value).length !== 1) return "Enter one keep point on the side to keep."; } catch (error) { return (error as Error).message; }
    if (controls.planeSource.value === "feature" && !controls.planeFeature.value) return "Choose the plane feature to trim with.";
    if (controls.planeSource.value === "body" && !controls.toolBody.value) return "Choose the trimming body.";
    if (controls.planeSource.value === "principal" && !Number.isFinite(Number(controls.offset.value))) return "Enter a finite plane offset.";
    return bodiesValid(controls, "surface body", 1);
  },
  serialize(values) {
    if (values.planeSource === "body") {
      return { bodyIds: JSON.parse(values.bodies), keepPointMillimeters: parsePoints3D(values.keep)[0], toolBodyId: values.toolBody };
    }
    return { bodyIds: JSON.parse(values.bodies), keepPointMillimeters: parsePoints3D(values.keep)[0], plane: values.planeSource === "feature" ? { kind: "feature", featureId: values.planeFeature } : { kind: "principal", plane: values.plane, offsetMillimeters: Number(values.offset) } };
  },
};
