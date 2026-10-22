import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Cosmetic thread: an ISO metric designation on a cylindrical face. */
export const threadEditor: FeatureEditor = {
  type: "thread",
  controls({ field, feature }: FeatureEditorContext) {
    return {
      face: field("Thread face", JSON.stringify(feature?.face ? [feature.face] : [])),
      designation: field("Designation", feature?.designation ?? "M8"),
      length: field("Length (mm, blank = whole face)", feature?.lengthMillimeters === undefined ? "" : String(feature.lengthMillimeters)),
    };
  },
  layout(context, controls) {
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, {
      title: "Cylindrical face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick one cylindrical face. The thread is cosmetic: the model is unchanged and the tree lists it.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); },
    });
  },
  validate(controls) {
    const face = JSON.parse(controls.face.value)[0] as SolidFaceReference | undefined;
    if (!face) return "Pick the cylindrical face.";
    if (face.surfaceType !== "cylinder") return "The thread face must be cylindrical.";
    if (!/^M\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?$/i.test(controls.designation.value.trim())) return "Use an ISO metric designation such as M8 or M8x1.";
    if (controls.length.value.trim() && !(Number(controls.length.value) > 0)) return "Length must be positive.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    return { face, designation: values.designation.trim(), ...(values.length?.trim() ? { lengthMillimeters: Number(values.length) } : {}) };
  },
};
