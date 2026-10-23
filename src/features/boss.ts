import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { plasticRuleFor } from "@aether/core/document";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Plastic Boss: raised out of a picked planar face at a point. */
export const bossEditor: FeatureEditor = {
  type: "boss",
  controls({ field, feature, doc }: FeatureEditorContext) {
    return {
      face: field("Boss face", JSON.stringify(feature?.face ? [feature.face] : [])),
      pointX: field("Point X (mm)", String(feature?.pointMillimeters?.[0] ?? 0)), pointY: field("Point Y (mm)", String(feature?.pointMillimeters?.[1] ?? 0)), pointZ: field("Point Z (mm)", String(feature?.pointMillimeters?.[2] ?? 0)),
      diameter: field("Diameter (mm)", String(feature?.diameterMillimeters ?? 6)),
      height: field("Height (mm)", String(feature?.heightMillimeters ?? 8)),
      holeDiameter: field("Hole diameter (mm, blank = none)", feature?.holeDiameterMillimeters === undefined ? "" : String(feature.holeDiameterMillimeters)),
      holeDepth: field("Hole depth (mm)", feature?.holeDepthMillimeters === undefined ? "" : String(feature.holeDepthMillimeters)),
      draft: field("Draft (degrees)", String(feature?.draftDegrees ?? plasticRuleFor(doc)?.draftDegrees ?? 0)),
    };
  },
  layout(context, controls) {
    const faces = mountPickedReferences<SolidFaceReference & { centerMillimeters?: [number, number, number] }>(context, controls.face, {
      title: "Boss face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
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
    const d = Number(controls.diameter.value), h = Number(controls.height.value);
    if (!(d > 0 && h > 0)) return "Enter a positive diameter and height.";
    const hd = controls.holeDiameter.value.trim(), hh = controls.holeDepth.value.trim();
    if ((hd === "") !== (hh === "")) return "A hole needs both a diameter and a depth.";
    if (hd && !(Number(hd) > 0 && Number(hd) < d && Number(hh) > 0)) return "The hole must be narrower than the boss and have a positive depth.";
    if (!(Number(controls.draft.value) >= 0 && Number(controls.draft.value) < 45)) return "Draft must be between 0 and 45 degrees.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    return {
      face, targetBodyId: face.bodyId, pointMillimeters: [Number(values.pointX), Number(values.pointY), Number(values.pointZ)],
      diameterMillimeters: Number(values.diameter), heightMillimeters: Number(values.height),
      ...(values.holeDiameter?.trim() ? { holeDiameterMillimeters: Number(values.holeDiameter), holeDepthMillimeters: Number(values.holeDepth) } : {}),
      ...(Number(values.draft) > 0 ? { draftDegrees: Number(values.draft) } : {}),
    };
  },
};
