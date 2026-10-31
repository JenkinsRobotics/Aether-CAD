import { availableBodies, type SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Shape Binder: a live copy of an earlier part, or of picked faces of it, as a new part. */
export const shapeBinderEditor: FeatureEditor = {
  type: "shape-binder",
  controls({ field, feature, doc }: FeatureEditorContext) {
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const choices = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const source = field("Source part", feature?.sourceBodyId ?? choices[0]?.id ?? "", choices.map((b) => b.id));
    Array.from(source.children).forEach((o, i) => (o.textContent = choices[i].name));
    return { source, faces: field("Faces", JSON.stringify(feature?.faces ?? [])) };
  },
  layout(context, controls) {
    const picker = mountPickedReferences<SolidFaceReference>(context, controls.faces, {
      title: "Faces to bind (none = whole part)", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick faces of the source part to bind them as a sheet; with none picked the whole part is copied. The copy follows the source on every rebuild.",
      onChange: (picked) => { if (picked.length > 64) picker.update(picked.slice(0, 64)); },
    });
  },
  validate(controls) {
    if (!controls.source.value) return "Choose the source part.";
    const faces = JSON.parse(controls.faces.value) as SolidFaceReference[];
    if (faces.some((face) => face.bodyId !== controls.source.value)) return "Picked faces must belong to the source part.";
    return null;
  },
  serialize(values) {
    const faces = (JSON.parse(values.faces) as (SolidFaceReference & { centerMillimeters?: unknown })[]).map((face) => { delete face.centerMillimeters; return face; });
    return { sourceBodyId: values.source, operation: "new", ...(faces.length ? { faces } : {}) };
  },
};
