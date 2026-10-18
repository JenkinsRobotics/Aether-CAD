import { regionControls, layoutRegion, selectedRegion } from "./regions";
import { sketchRegions } from "../freecad-translate";
import {
  bodyAndOperationTabs,
  entityChips,
  requireSelections,
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
      path: reference("Sweep Path", ["sketch", "profile"], feature?.pathFeatureId),
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
  },

  validate(controls, context) {
    if (controls.profile.value === controls.path.value && controls.profile.value) return "Choose a separate sketch for the sweep path.";
    const profile = context.doc.features.find(feature => feature.id === controls.profile.value);
    if (profile && (!sketchRegions(profile, false, context.doc.features).length || !controls.region.value)) return "Choose a closed profile region.";
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
      operation: values.operation,
    };
  },
};
