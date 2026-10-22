import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { requireSelections, type FeatureEditor } from "./shared";

/** The drafted faces come as picks (several at once, as SolidCraft's `faces`) or,
 *  for saved documents, as the one face lying in a principal plane. */
export const draftEditor: FeatureEditor = {
  type: "draft",
  controls({ field, feature }) {
    return {
      faceScope: field("Faces", feature?.faces ? "picked" : "plane", ["picked", "plane"]),
      faces: field("Picked faces", JSON.stringify(feature?.faces ?? [])),
      facePlane: field("Face plane", feature?.facePlane.plane ?? "XZ", ["XY", "XZ", "YZ"]),
      faceOffset: field("Face plane offset (mm)", String(feature?.facePlane.offsetMillimeters ?? 0)),
      neutralScope: field("Neutral", feature?.neutralFace ? "face" : "plane", ["plane", "face"]),
      neutralFace: field("Neutral face", JSON.stringify(feature?.neutralFace ? [feature.neutralFace] : [])),
      neutralPlane: field("Neutral plane", feature?.neutralPlane.plane ?? "XY", ["XY", "XZ", "YZ"]),
      neutralOffset: field("Neutral plane offset (mm)", String(feature?.neutralPlane.offsetMillimeters ?? 0)),
      angle: field("Draft angle (degrees)", String(feature?.angleDegrees ?? 5)),
      direction: field("Direction", feature?.reversed ? "reverse" : "normal", ["normal", "reverse"]),
      pullMode: field("Pull direction", feature?.pullDirection ? "custom" : "neutral", ["neutral", "custom"]),
      pullX: field("Pull X", String(feature?.pullDirection?.[0] ?? 0)), pullY: field("Pull Y", String(feature?.pullDirection?.[1] ?? 0)), pullZ: field("Pull Z", String(feature?.pullDirection?.[2] ?? 1)),
    };
  },
  layout(context, controls) {
    const row = (key: string) => controls[key].closest<HTMLElement>(".aui-feature-row") ?? controls[key].parentElement;
    const syncPull = () => { for (const key of ["pullX", "pullY", "pullZ"]) { const el = row(key); if (el) el.hidden = controls.pullMode.value !== "custom"; } };
    controls.pullMode.addEventListener("change", syncPull); syncPull();
    mountPickedReferences<SolidFaceReference>(context, controls.faces, {
      title: "Faces to draft", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick the planar faces to tilt. They turn about the neutral plane by the angle.",
      onChange: (faces) => { if (faces.length) { controls.faceScope.value = "picked"; controls.faceScope.dispatchEvent(new Event("change")); } },
    });
    const neutral = mountPickedReferences<SolidFaceReference>(context, controls.neutralFace, {
      title: "Neutral face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Optional: a planar face the draft pivots about, instead of a principal plane.",
      onChange: (faces) => { if (faces.length > 1) neutral.update([faces[faces.length - 1]]); else { controls.neutralScope.value = faces.length ? "face" : "plane"; controls.neutralScope.dispatchEvent(new Event("change")); } },
    });
  },
  validate(controls) {
    if (controls.pullMode.value === "custom" && Math.hypot(Number(controls.pullX.value), Number(controls.pullY.value), Number(controls.pullZ.value)) < 1e-9) return "Enter a nonzero pull direction.";
    if (controls.faceScope.value === "picked" && !JSON.parse(controls.faces.value).length) return "Pick at least one face to draft, or choose a face plane.";
    if (controls.neutralScope.value === "face" && !JSON.parse(controls.neutralFace.value).length) return "Pick the neutral face, or choose a neutral plane.";
    return requireSelections(controls, [{ key: "target", noun: "a target body" }]);
  },
  serialize(values) {
    return {
      facePlane: { plane: values.facePlane, offsetMillimeters: Number(values.faceOffset) },
      ...(values.faceScope === "picked" ? { faces: JSON.parse(values.faces) } : {}),
      neutralPlane: { plane: values.neutralPlane, offsetMillimeters: Number(values.neutralOffset) },
      ...(values.neutralScope === "face" ? { neutralFace: JSON.parse(values.neutralFace)[0] } : {}),
      angleDegrees: Number(values.angle), reversed: values.direction === "reverse",
      ...(values.pullMode === "custom" ? { pullDirection: [Number(values.pullX), Number(values.pullY), Number(values.pullZ)] } : {}),
    };
  },
};
