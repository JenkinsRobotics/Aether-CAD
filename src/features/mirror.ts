/** Mirror feature editor: the feature to mirror, then the mirror plane, which is
 *  a principal plane with an offset, an earlier plane feature, or a picked planar
 *  face (SolidCraft's `plane: XY|name|{origin, normal}`). Whole parts are mirrored
 *  with Transform › Mirror. */
import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { entityChips, requireSelections, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

export const mirrorEditor: FeatureEditor = {
  type: "mirror",

  controls({ field, reference, feature }: FeatureEditorContext): Controls {
    const mp = feature?.mirrorPlane;
    return {
      source: reference("Feature", ["extrude", "revolve", "mirror"], feature?.sourceFeatureId),
      planeSource: field("Mirror plane source", mp?.kind ?? "principal", ["principal", "feature", "face"]),
      plane: field("Mirror plane", feature?.plane ?? "YZ", ["XY", "XZ", "YZ"]),
      offset: field("Plane offset (mm)", String(feature?.offsetMillimeters ?? 0)),
      planeFeature: reference("Plane feature", ["plane"], mp?.kind === "feature" ? mp.featureId : undefined),
      face: field("Mirror face", JSON.stringify(mp?.kind === "face" ? [mp] : [])),
      operation: field("Operation", feature?.operation ?? "add", ["add", "cut"]),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form } = context;
    entityChips(win, "Features to mirror", controls.source, form);
    const row = (key: string) => controls[key].closest<HTMLElement>(".aui-feature-row") ?? controls[key].parentElement;
    const render = () => { const source = controls.planeSource.value; for (const [key, when] of [["plane", "principal"], ["offset", "principal"], ["planeFeature", "feature"]] as const) { const element = row(key); if (element) element.hidden = source !== when; } };
    controls.planeSource.addEventListener("change", render); render();
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, {
      title: "Mirror face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Optional: a planar face to mirror about, instead of a plane.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); else { controls.planeSource.value = picked.length ? "face" : "principal"; controls.planeSource.dispatchEvent(new Event("change")); } },
    });
  },

  validate(controls) {
    if (controls.planeSource.value === "feature" && !controls.planeFeature.value) return "Choose the plane feature to mirror about.";
    if (controls.planeSource.value === "face" && !JSON.parse(controls.face.value).length) return "Pick the planar face to mirror about.";
    return requireSelections(controls, [
      { key: "source", noun: "a feature to mirror" },
      { key: "plane", noun: "a mirror plane" },
    ]);
  },

  serialize(values) {
    return {
      sourceFeatureId: values.source,
      plane: values.plane,
      offsetMillimeters: Number(values.offset),
      ...(values.planeSource === "feature" ? { mirrorPlane: { kind: "feature", featureId: values.planeFeature } }
        : values.planeSource === "face" ? { mirrorPlane: { kind: "face", ...JSON.parse(values.face)[0] } } : {}),
      operation: values.operation,
    };
  },
};
