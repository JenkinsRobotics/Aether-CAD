import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor } from "./shared";

/** Delete Face: the picked faces go and their neighbours close the gap. */
export const deleteFaceEditor: FeatureEditor = {
  type: "delete-face",
  controls({ field, feature }) {
    return { faces: field("Faces to delete", JSON.stringify(feature?.faces ?? [])) };
  },
  layout(context, controls) {
    mountPickedReferences<SolidFaceReference>(context, controls.faces, {
      title: "Faces to delete", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick faces on one part. Their neighbours extend to heal the gap; a face that cannot be healed is refused.",
    });
  },
  validate(controls) {
    const faces = JSON.parse(controls.faces.value) as SolidFaceReference[];
    if (!faces.length) return "Pick at least one face to delete.";
    if (new Set(faces.map((f) => f.bodyId)).size > 1) return "Pick faces on one part at a time.";
    return null;
  },
  serialize(values) {
    const faces = (JSON.parse(values.faces) as (SolidFaceReference & { centerMillimeters?: unknown })[]).map((f) => { delete f.centerMillimeters; return f; });
    return { faces, targetBodyId: faces[0].bodyId };
  },
};
