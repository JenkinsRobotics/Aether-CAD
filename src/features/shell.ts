import type { ShellOpenFace, SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { checkRow, iconButton, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

/** Shell, as Onshape's: Hollow (no faces removed), the Faces to remove box, Shell thickness
 *  with its flip (inside or outside). Saved documents may still open every face in a
 *  principal plane; those rows show only for them. */
export const shellEditor: FeatureEditor = {
  type: "shell",

  controls({ field, feature }: FeatureEditorContext): Controls {
    const removed = (feature?.removedFaces ?? []) as ShellOpenFace[];
    const picked = removed.filter((face) => "sourceFeatureId" in face);
    const planes = removed.filter((face) => !("sourceFeatureId" in face));
    return {
      hollow: field("Hollow", String(Boolean(feature) && !removed.length), ["false", "true"]),
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
    const { win, form, feature, lengthUnitLabel } = context;
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    for (const key of ["direction", "removeScope", "removePlane", "removeOffset", "tangentChain"] as const) hide(controls[key]);
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.faces, {
      title: "Faces to remove", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      onChange: (picked) => { if (picked.length) { controls.removeScope.value = "picked"; controls.hollow.value = "false"; controls.hollow.dispatchEvent(new Event("change")); sync(); } },
    });
    const hollow = checkRow(context, controls.hollow, "Hollow", () => { if (controls.hollow.value === "true") { faces.update([]); controls.removeScope.value = "none"; } sync(); });
    win.body.insertBefore(hollow, faces.element);
    controls.thickness.closest("label")?.remove(); controls.thickness.setAttribute("form", form.id);
    const flip = iconButton("flip-horizontal", "Flip shell direction");
    const paint = () => flip.setAttribute("aria-pressed", String(controls.direction.value === "outside"));
    flip.onclick = () => { controls.direction.value = controls.direction.value === "outside" ? "inside" : "outside"; paint(); controls.direction.dispatchEvent(new Event("change")); };
    paint();
    win.body.append(rowIn("Shell thickness", controls.thickness, unitSuffix(lengthUnitLabel), flip));
    checkRow(context, controls.tangentChain, "Tangent propagation");
    // Saved-document scope: every face in a principal plane.
    if ((feature?.removedFaces as ShellOpenFace[] | undefined)?.some((face) => !("sourceFeatureId" in face))) {
      const scope = win.row("Faces to remove", controls.removeScope), plane = win.row("Removed face plane", controls.removePlane), offset = win.row("Removed plane offset", controls.removeOffset, unitSuffix(lengthUnitLabel));
      for (const control of [controls.removeScope, controls.removePlane, controls.removeOffset]) control.hidden = false;
      const syncScope = () => { plane.hidden = offset.hidden = controls.removeScope.value !== "plane"; };
      scope.hidden = false; controls.removeScope.addEventListener("change", syncScope); syncScope();
    }
    function sync() { faces.element.hidden = controls.hollow.value === "true"; }
    sync();
  },

  validate(controls) {
    if (!(Number(controls.thickness.value) > 0)) return "Enter a positive shell thickness.";
    if (controls.hollow.value !== "true" && controls.removeScope.value === "picked" && !JSON.parse(controls.faces.value).length) return "Select the faces to remove, or tick Hollow.";
    if (controls.hollow.value !== "true" && controls.removeScope.value === "none") return "Select the faces to remove, or tick Hollow.";
    return null;
  },

  serialize(values) {
    return {
      thicknessMillimeters: Number(values.thickness),
      ...(values.direction && values.direction !== "inside" ? { direction: values.direction } : {}),
      ...(values.hollow === "true" ? {}
        : values.removeScope === "plane"
        ? { removedFaces: [{ plane: values.removePlane, offsetMillimeters: Number(values.removeOffset) }] }
        : values.removeScope === "picked" ? { removedFaces: JSON.parse(values.faces), ...(values.tangentChain === "yes" ? { tangentChain: true } : {}) } : {}),
    };
  },
};
