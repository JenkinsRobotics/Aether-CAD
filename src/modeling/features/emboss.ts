/** Wrap & Emboss feature editor (`solid-wrap-emboss`): raises (emboss) or recesses (deboss)
 *  a sketch profile onto a picked planar or cylindrical face. */
import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

export const embossEditor: FeatureEditor = {
  type: "emboss",
  controls({ field, reference, feature }: FeatureEditorContext): Controls {
    return {
      profileFeatureId: reference("Sketch profile", ["profile", "sketch"], feature?.profileFeatureId),
      face: field("Target face", JSON.stringify(feature?.face ? [feature.face] : [])),
      mode: field("Effect", feature?.mode ?? "emboss", ["emboss", "deboss"]),
      depthMillimeters: field("Depth (mm)", String(feature?.depthMillimeters ?? 2)),
      alignment: field("Alignment", feature?.alignment ?? "center", ["center", "origin"]),
      rotationDegrees: field("Rotation (degrees)", String(feature?.rotationDegrees ?? 0)),
    };
  },
  layout(context, controls) {
    const { win, form, lengthUnitLabel, angleUnitLabel } = context;
    const row = (label: string, control: Controls[string], unit?: string) => {
      control.closest("label")?.remove();
      control.setAttribute("form", form.id);
      win.body.append(unit ? rowIn(label, control, unitSuffix(unit)) : rowIn(label, control));
    };
    row("Sketch profile", controls.profileFeatureId);
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, {
      title: "Target face (planar or cylindrical)",
      kind: "face",
      requestEvent: "aether-offset-faces-request",
      replyEvent: "aether-offset-faces",
      replyKey: "faces",
      identity: faceIdentity,
      note: "Pick a planar or cylindrical face to wrap and emboss or deboss the sketch onto.",
      onChange: (picked) => {
        if (picked.length > 1) faces.update([picked[picked.length - 1]]);
      },
    });
    row("Effect", controls.mode);
    row("Depth", controls.depthMillimeters, lengthUnitLabel);
    row("Alignment", controls.alignment);
    row("Rotation", controls.rotationDegrees, angleUnitLabel);
  },
  validate(controls) {
    if (!controls.profileFeatureId.value) return "Choose a sketch profile to emboss.";
    const face = JSON.parse(controls.face.value || "[]")[0] as SolidFaceReference | undefined;
    if (!face) return "Pick a planar or cylindrical target face.";
    if (!(Number(controls.depthMillimeters.value) > 0)) return "Emboss depth must be greater than zero.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown };
    delete face.centerMillimeters;
    const rot = Number(values.rotationDegrees);
    return {
      profileFeatureId: values.profileFeatureId,
      face,
      targetBodyId: face.bodyId,
      mode: values.mode,
      depthMillimeters: Number(values.depthMillimeters),
      alignment: values.alignment,
      ...(Number.isFinite(rot) && Math.abs(rot) > 1e-9 ? { rotationDegrees: rot } : {}),
    };
  },
};
