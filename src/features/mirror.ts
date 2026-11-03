/** Mirror, as Onshape's: the features to mirror, one Mirror plane box (a tree plane, a Plane
 *  feature or a picked planar face) and the Add / Remove operation. Whole parts are mirrored
 *  with Transform › Mirror. */
import type { MirrorPlaneReference } from "@aether/core/document";
import { mountPlaneBox } from "./plane-box";
import { entityChips, operationTabs, requireSelections, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

export const mirrorEditor: FeatureEditor = {
  type: "mirror",

  controls({ field, reference, feature }: FeatureEditorContext): Controls {
    const saved: MirrorPlaneReference | null = feature?.mirrorPlane ?? (feature ? { kind: "principal", plane: feature.plane, offsetMillimeters: feature.offsetMillimeters } : null);
    return {
      source: reference("Feature", ["extrude", "revolve", "mirror"], feature?.sourceFeatureId),
      planeRef: field("Mirror plane reference", saved ? JSON.stringify(saved) : ""),
      operation: field("Operation", feature?.operation ?? "add", ["add", "cut"]),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form } = context;
    operationTabs(win, form, controls.operation, ["add", "cut"], ["Add", "Remove"]);
    entityChips(win, "Features to mirror", controls.source, form);
    mountPlaneBox(context, controls.planeRef, "Mirror plane");
  },

  validate(controls) {
    if (!controls.planeRef.value) return "Select the mirror plane: a plane in the tree or a planar face.";
    return requireSelections(controls, [{ key: "source", noun: "a feature to mirror" }]);
  },

  serialize(values) {
    const ref = JSON.parse(values.planeRef) as MirrorPlaneReference;
    if (ref.kind === "face") delete (ref as { centerMillimeters?: unknown }).centerMillimeters;
    return {
      sourceFeatureId: values.source,
      plane: ref.kind === "principal" ? ref.plane : "XY",
      offsetMillimeters: ref.kind === "principal" ? ref.offsetMillimeters : 0,
      ...(ref.kind === "principal" ? {} : { mirrorPlane: ref }),
      operation: values.operation,
    };
  },
};
