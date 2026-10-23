import type { SolidFaceReference } from "@aether/core/document";
import { plasticRuleFor } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Plastic Snap Fit: a cantilever hook out of a planar face at a point. */
export const snapFitEditor: FeatureEditor = {
  type: "snap-fit",
  controls({ field, feature, doc }: FeatureEditorContext) {
    const rule = plasticRuleFor(doc, feature?.targetBodyId);
    const t = rule?.thicknessMillimeters ?? 1.5;
    return {
      face: field("Face", JSON.stringify(feature?.face ? [feature.face] : [])),
      pointX: field("Point X (mm)", String(feature?.pointMillimeters?.[0] ?? 0)), pointY: field("Point Y (mm)", String(feature?.pointMillimeters?.[1] ?? 0)), pointZ: field("Point Z (mm)", String(feature?.pointMillimeters?.[2] ?? 0)),
      hookX: field("Hook X", String(feature?.hookDirectionMillimeters?.[0] ?? 1)), hookY: field("Hook Y", String(feature?.hookDirectionMillimeters?.[1] ?? 0)), hookZ: field("Hook Z", String(feature?.hookDirectionMillimeters?.[2] ?? 0)),
      length: field("Arm length (mm)", String(feature?.lengthMillimeters ?? t * 6)),
      thickness: field("Arm thickness (mm)", String(feature?.thicknessMillimeters ?? t)),
      width: field("Width (mm)", String(feature?.widthMillimeters ?? t * 3)),
      catchDepth: field("Catch depth (mm)", String(feature?.catchDepthMillimeters ?? t * 0.6)),
      catchLength: field("Catch length (mm)", String(feature?.catchLengthMillimeters ?? t * 1.2)),
    };
  },
  layout(context, controls) {
    const faces = mountPickedReferences<SolidFaceReference & { centerMillimeters?: [number, number, number] }>(context, controls.face, {
      title: "Face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick the planar face the arm grows out of; the point defaults to its centre. The hook direction lies across the face.",
      onChange: (picked) => {
        if (picked.length > 1) { faces.update([picked[picked.length - 1]]); return; }
        const c = picked[0]?.centerMillimeters; if (c) { controls.pointX.value = String(c[0]); controls.pointY.value = String(c[1]); controls.pointZ.value = String(c[2]); }
      },
    });
  },
  validate(controls) {
    const face = JSON.parse(controls.face.value)[0] as SolidFaceReference | undefined;
    if (!face) return "Pick the face.";
    if (face.surfaceType) return "The face must be planar.";
    const sizes = ["length", "thickness", "width", "catchDepth", "catchLength"].map((k) => Number(controls[k].value));
    if (sizes.some((v) => !(v > 0))) return "Enter positive sizes.";
    if (Number(controls.catchLength.value) >= Number(controls.length.value)) return "The catch must be shorter than the arm.";
    if (!(Math.hypot(Number(controls.hookX.value), Number(controls.hookY.value), Number(controls.hookZ.value)) > 0)) return "Enter a hook direction.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    return {
      face, targetBodyId: face.bodyId, pointMillimeters: [Number(values.pointX), Number(values.pointY), Number(values.pointZ)],
      hookDirectionMillimeters: [Number(values.hookX), Number(values.hookY), Number(values.hookZ)],
      lengthMillimeters: Number(values.length), thicknessMillimeters: Number(values.thickness), widthMillimeters: Number(values.width),
      catchDepthMillimeters: Number(values.catchDepth), catchLengthMillimeters: Number(values.catchLength),
    };
  },
};
