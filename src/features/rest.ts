import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Plastic Rest: raised out of a picked planar face at a point. */
export const restEditor: FeatureEditor = {
  type: "rest",
  controls({ field, feature }: FeatureEditorContext) {
    return {
      face: field("Rest face", JSON.stringify(feature?.face ? [feature.face] : [])),
      pointX: field("Point X (mm)", String(feature?.pointMillimeters?.[0] ?? 0)), pointY: field("Point Y (mm)", String(feature?.pointMillimeters?.[1] ?? 0)), pointZ: field("Point Z (mm)", String(feature?.pointMillimeters?.[2] ?? 0)),
      width: field("Width / diameter (mm)", String(feature?.widthMillimeters ?? 8)),
      length: field("Length (mm, blank = round)", feature?.lengthMillimeters === undefined ? "" : String(feature.lengthMillimeters)),
      height: field("Height (mm)", String(feature?.heightMillimeters ?? 2)),
      draft: field("Draft (degrees)", String(feature?.draftDegrees ?? 0)),
    };
  },
  layout(context, controls) {
    const faces = mountPickedReferences<SolidFaceReference & { centerMillimeters?: [number, number, number] }>(context, controls.face, {
      title: "Rest face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick the planar face; the point defaults to its centre.",
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
    const w = Number(controls.width.value), h = Number(controls.height.value);
    if (!(w > 0 && h > 0)) return "Enter a positive width and height.";
    if (controls.length.value.trim() && !(Number(controls.length.value) > 0)) return "Length must be positive.";
    if (!(Number(controls.draft.value) >= 0 && Number(controls.draft.value) < 45)) return "Draft must be between 0 and 45 degrees.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    return {
      face, targetBodyId: face.bodyId, pointMillimeters: [Number(values.pointX), Number(values.pointY), Number(values.pointZ)],
      widthMillimeters: Number(values.width), heightMillimeters: Number(values.height),
      ...(values.length?.trim() ? { lengthMillimeters: Number(values.length) } : {}),
      ...(Number(values.draft) > 0 ? { draftDegrees: Number(values.draft) } : {}),
    };
  },
};
