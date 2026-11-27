import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor } from "./shared";

/** Split Face: the picked faces divided where a plane crosses them; the part keeps its shape. */
export const splitFaceEditor: FeatureEditor = {
  type: "split-face",
  handles: false,
  controls({ field, reference, feature }) {
    const plane = feature?.plane;
    return {
      faces: field("Faces to split", JSON.stringify(feature?.faces ?? [])),
      planeSource: field("Plane source", plane?.kind === "feature" ? "feature" : "principal", ["principal", "feature"]),
      plane: field("Plane", plane?.kind === "principal" ? plane.plane : "YZ", ["XY", "XZ", "YZ"]),
      offset: field("Plane offset (mm)", String(plane?.kind === "principal" ? plane.offsetMillimeters : 0)),
      planeFeature: reference("Plane feature", ["plane"], plane?.kind === "feature" ? plane.featureId : undefined),
    };
  },
  layout(context, controls) {
    mountPickedReferences<SolidFaceReference>(context, controls.faces, {
      title: "Faces to split", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick faces on one part. Each is divided where the plane crosses it; the part keeps its volume.",
    });
    const row = (key: string) => controls[key].closest<HTMLElement>(".aui-feature-row") ?? controls[key].parentElement;
    const sync = () => { const principal = controls.planeSource.value === "principal"; for (const key of ["plane", "offset"]) { const r = row(key); if (r) r.hidden = !principal; } const r = row("planeFeature"); if (r) r.hidden = principal; };
    controls.planeSource.addEventListener("change", sync); sync();
  },
  validate(controls) {
    const faces = JSON.parse(controls.faces.value) as SolidFaceReference[];
    if (!faces.length) return "Pick the faces to split.";
    if (new Set(faces.map((f) => f.bodyId)).size > 1) return "Pick faces on one part at a time.";
    if (controls.planeSource.value === "feature" && !controls.planeFeature.value) return "Choose the plane feature to split with.";
    if (controls.planeSource.value === "principal" && !Number.isFinite(Number(controls.offset.value))) return "Enter a finite plane offset.";
    return null;
  },
  serialize(values) {
    const faces = (JSON.parse(values.faces) as (SolidFaceReference & { centerMillimeters?: unknown })[]).map((f) => { delete f.centerMillimeters; return f; });
    return { faces, targetBodyId: faces[0].bodyId, plane: values.planeSource === "feature" ? { kind: "feature", featureId: values.planeFeature } : { kind: "principal", plane: values.plane, offsetMillimeters: Number(values.offset) } };
  },
};
