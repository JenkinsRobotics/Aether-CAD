import type { ShellOpenFace, SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

/** Faces to open come as picks (the viewer's exact references) or, for saved
 *  documents, as every face in a principal plane. */
export const shellEditor: FeatureEditor = {
  type: "shell",

  controls({ field, feature }: FeatureEditorContext): Controls {
    const removed = (feature?.removedFaces ?? []) as ShellOpenFace[];
    const picked = removed.filter((face) => "sourceFeatureId" in face);
    const planes = removed.filter((face) => !("sourceFeatureId" in face));
    return {
      thickness: field("Thickness (mm)", String(feature?.thicknessMillimeters ?? 1)),
      direction: field("Direction", feature?.direction ?? "inside", ["inside", "outside", "both"]),
      removeScope: field("Faces to remove", picked.length ? "picked" : planes.length ? "plane" : "none", ["none", "plane", "picked"]),
      removePlane: field("Removed face plane", (planes[0] as { plane?: string } | undefined)?.plane ?? "XY", ["XY", "XZ", "YZ"]),
      removeOffset: field("Removed plane offset (mm)", String((planes[0] as { offsetMillimeters?: number } | undefined)?.offsetMillimeters ?? 0)),
      faces: field("Picked faces", JSON.stringify(picked)),
      tangentChain: field("Also open faces joined smoothly", feature?.tangentChain ? "yes" : "no", ["no", "yes"]),
    };
  },

  layout(context, controls) {
    mountPickedReferences<SolidFaceReference>(context, controls.faces, {
      title: "Faces to open", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick the faces to remove in the viewport. Leave the list empty for a closed shell.",
      onChange: (faces) => { if (faces.length) { controls.removeScope.value = "picked"; controls.removeScope.dispatchEvent(new Event("change")); } },
    });
  },

  validate(controls) {
    if (controls.removeScope.value === "picked" && !JSON.parse(controls.faces.value).length) return "Pick at least one face to open, or choose a closed shell.";
    return null;
  },

  serialize(values) {
    return {
      thicknessMillimeters: Number(values.thickness),
      ...(values.direction && values.direction !== "inside" ? { direction: values.direction } : {}),
      ...(values.removeScope === "plane"
        ? { removedFaces: [{ plane: values.removePlane, offsetMillimeters: Number(values.removeOffset) }] }
        : values.removeScope === "picked" ? { removedFaces: JSON.parse(values.faces), ...(values.tangentChain === "yes" ? { tangentChain: true } : {}) } : {}),
    };
  },
};
