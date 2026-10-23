import { regionControls, layoutRegion, selectedRegion } from "./regions";
import { sketchRegions } from "@aether/core/document";
import {
  bodyAndOperationTabs,
  entityChips,
  requireSelections,
  layoutParameterRows,
  type Controls,
  type FeatureEditor,
  type FeatureEditorContext,
} from "./shared";

const operationValues = ["new", "add", "cut"] as const;

export const sweepEditor: FeatureEditor = {
  type: "sweep",

  controls(context: FeatureEditorContext): Controls {
    const { field, reference, feature, doc } = context;
    const profile = reference("Sketch Profile", ["sketch", "profile"], feature?.profileFeatureId);
    return {
      profile,
      region: regionControls(context, profile),
      path: reference("Sweep Path", ["sketch", "profile", "curve3d"], feature?.pathFeatureId),
      orientation: field("Orientation", typeof feature?.orientation === "object" ? "direction" : feature?.orientation ?? "perpendicular", ["perpendicular", "parallel", "direction"]),
      upX: field("Up direction X", String(typeof feature?.orientation === "object" ? feature.orientation.direction[0] : 0)),
      upY: field("Up direction Y", String(typeof feature?.orientation === "object" ? feature.orientation.direction[1] : 0)),
      upZ: field("Up direction Z", String(typeof feature?.orientation === "object" ? feature.orientation.direction[2] : 1)),
      endScale: field("End scale", String(feature?.endScale ?? 1)),
      rail: reference("Guide rail", ["sketch", "profile", "curve3d"], feature?.rail?.pathFeatureId),
      operation: field(
        "Operation",
        feature?.operation ??
          (doc.features.some((f) => ["extrude", "revolve", "sweep"].includes(f.type)) ? "add" : "new"),
        [...operationValues],
      ),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form } = context;
    bodyAndOperationTabs(win, form, controls.operation, operationValues);
    entityChips(win, "Faces and sketch regions to sweep", controls.profile, form);
    layoutRegion(context, controls.profile, controls.region);
    entityChips(win, "Sweep path", controls.path, form);
    const rows = layoutParameterRows(context, (control) => control === controls.rail);
    entityChips(win, "Guide rail (optional)", controls.rail, form);
    for (const option of controls.orientation.children) option.textContent = ({ perpendicular: "Square to the path", parallel: "As drawn (no turning)", direction: "Square to the path, fixed up" } as Record<string, string>)[(option as HTMLOptionElement).value];
    const sync = () => { for (const key of ["upX", "upY", "upZ"]) rows.get(controls[key])!.hidden = controls.orientation.value !== "direction"; };
    controls.orientation.addEventListener("change", sync); sync();
  },

  validate(controls, context) {
    if (controls.profile.value === controls.path.value && controls.profile.value) return "Choose a separate sketch for the sweep path.";
    const profile = context.doc.features.find(feature => feature.id === controls.profile.value);
    if (profile && (!sketchRegions(profile, false, context.doc.features).length || !controls.region.value)) return "Choose a closed profile region.";
    const endScale = Number(controls.endScale.value);
    if (!(endScale >= 0.01 && endScale <= 100)) return "End scale must be between 0.01 and 100.";
    if (controls.orientation.value === "direction" && Math.hypot(Number(controls.upX.value), Number(controls.upY.value), Number(controls.upZ.value)) < 1e-9) return "Enter a nonzero up direction.";
    if (controls.rail.value && controls.rail.value === controls.path.value) return "Choose a rail sketch other than the path.";
    return requireSelections(controls, [
      { key: "profile", noun: "a sketch profile" },
      { key: "path", noun: "a sweep path" },
    ]);
  },

  serialize(values, context) {
    return {
      profileFeatureId: values.profile,
      ...selectedRegion(values, context, "profile"),
      pathFeatureId: values.path,
      ...(values.orientation === "parallel" ? { orientation: "parallel" } : values.orientation === "direction" ? { orientation: { kind: "direction", direction: [Number(values.upX), Number(values.upY), Number(values.upZ)] } } : {}),
      ...(Math.abs(Number(values.endScale) - 1) > 1e-9 ? { endScale: Number(values.endScale) } : {}),
      ...(values.rail ? { rail: { pathFeatureId: values.rail } } : {}),
      operation: values.operation,
    };
  },
};
