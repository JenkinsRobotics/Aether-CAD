import type { SolidFaceReference } from "@aether/core/document";
import { plasticRuleFor } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Plastic Lip / Groove: a band along the inside or outside edge of a shelled rim face. */
export const lipEditor: FeatureEditor = {
  type: "lip",
  controls({ field, feature, doc }: FeatureEditorContext) {
    const rule = plasticRuleFor(doc, feature?.targetBodyId);
    return {
      face: field("Rim face", JSON.stringify(feature?.face ? [feature.face] : [])),
      shape: field("Shape", feature?.shape ?? "lip", ["lip", "groove"]),
      side: field("Side", feature?.side ?? "inside", ["inside", "outside"]),
      width: field("Width (mm)", String(feature?.widthMillimeters ?? (rule ? rule.thicknessMillimeters / 2 : 0.75))),
      height: field("Height (mm)", String(feature?.heightMillimeters ?? (rule ? rule.thicknessMillimeters : 1.5))),
      gap: field("Groove gap (mm)", String(feature?.gapMillimeters ?? rule?.clearanceMillimeters ?? 0)),
    };
  },
  layout(context, controls) {
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, {
      title: "Rim face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick the planar rim face of a shelled body. Inside follows its inner edge, outside its outer edge.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); },
    });
  },
  validate(controls) {
    const face = JSON.parse(controls.face.value)[0] as SolidFaceReference | undefined;
    if (!face) return "Pick the rim face.";
    if (face.surfaceType) return "The rim face must be planar.";
    if (!(Number(controls.width.value) > 0 && Number(controls.height.value) > 0)) return "Enter a positive width and height.";
    if (!(Number(controls.gap.value) >= 0)) return "The gap must be zero or more.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    return { face, targetBodyId: face.bodyId, shape: values.shape, side: values.side, widthMillimeters: Number(values.width), heightMillimeters: Number(values.height), ...(Number(values.gap) > 0 ? { gapMillimeters: Number(values.gap) } : {}) };
  },
};
