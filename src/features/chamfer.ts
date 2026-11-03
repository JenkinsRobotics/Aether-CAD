/** Chamfer, as Onshape's: Entities to chamfer, Tangent propagation, the chamfer type (equal
 *  distance, two distances, distance and angle) with its rows and an optional reference face.
 *  Edge picking and the saved-document scopes live in edge-finish.ts. */
import type { SolidFaceReference } from "@aether/core/document";
import { edgeFinishControls, layoutEdgeFinish, serializeEdgeFinish, validateEdgeFinish } from "./edge-finish";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const chamferTypes = { "Equal distance": "equal", "Two distances": "two-distances", "Distance and angle": "distance-angle" } as const;

export const chamferEditor: FeatureEditor = {
  type: "chamfer",

  controls(context: FeatureEditorContext): Controls {
    const { field, feature } = context;
    const chamferType = feature?.angleDegrees !== undefined ? "distance-angle" : feature?.secondDistanceMillimeters !== undefined ? "two-distances" : "equal";
    return {
      ...edgeFinishControls(context),
      radius: field("Distance (mm)", String(feature?.radiusMillimeters ?? 0.5)),
      chamferType: field("Chamfer type", chamferType, Object.values(chamferTypes)),
      secondDistance: field("Second distance (mm)", String(feature?.secondDistanceMillimeters ?? feature?.radiusMillimeters ?? 0.5)),
      angle: field("Angle (degrees)", String(feature?.angleDegrees ?? 45)),
      referenceFace: field("Reference face", JSON.stringify(feature?.referenceFace ? [feature.referenceFace] : [])),
    };
  },

  layout(context, controls) {
    const { win, form, lengthUnitLabel } = context;
    controls.chamferType.closest("label")?.remove(); controls.chamferType.hidden = true; controls.chamferType.setAttribute("form", form.id); form.append(controls.chamferType);
    const picker = win.picker(Object.keys(chamferTypes), { ariaLabel: "Chamfer type menu", onChange: (value) => { controls.chamferType.value = chamferTypes[value as keyof typeof chamferTypes]; sync(); controls.chamferType.dispatchEvent(new Event("change")); } });
    picker.setValue(Object.keys(chamferTypes).find((key) => chamferTypes[key as keyof typeof chamferTypes] === controls.chamferType.value) ?? "Equal distance");
    win.body.append(picker.element);
    const row = (label: string, control: Controls[string], unit: string) => { control.closest("label")?.remove(); control.setAttribute("form", form.id); return win.body.appendChild(rowIn(label, control, unitSuffix(unit))); };
    row("Distance", controls.radius, lengthUnitLabel);
    const second = row("Second distance", controls.secondDistance, lengthUnitLabel), angle = row("Angle", controls.angle, "deg");
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.referenceFace, {
      title: "Reference face (optional)", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "The face the first distance lies on. Default: the adjacent face facing up most.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); },
    });
    const sync = () => { const mode = controls.chamferType.value; second.hidden = mode !== "two-distances"; angle.hidden = mode !== "distance-angle"; faces.element.hidden = mode === "equal"; };
    sync();
    // Mounted last so the entities box is the active pick when the window opens (one picker at a time).
    layoutEdgeFinish(context, controls, "Entities to chamfer");
  },

  validate(controls) {
    if (!(Number(controls.radius.value) > 0)) return "Enter a positive distance.";
    if (controls.chamferType.value === "two-distances" && !(Number(controls.secondDistance.value) > 0)) return "Enter a positive second distance.";
    if (controls.chamferType.value === "distance-angle" && !(Number(controls.angle.value) > 0 && Number(controls.angle.value) < 90)) return "Enter an angle between 0 and 90 degrees.";
    return validateEdgeFinish(controls, "chamfer");
  },

  serialize(values) {
    const face = values.chamferType === "equal" ? undefined : JSON.parse(values.referenceFace || "[]")[0];
    if (face) delete face.centerMillimeters;
    return {
      radiusMillimeters: Number(values.radius),
      ...(values.chamferType === "two-distances" ? { secondDistanceMillimeters: Number(values.secondDistance) } : {}),
      ...(values.chamferType === "distance-angle" ? { angleDegrees: Number(values.angle) } : {}),
      ...(face ? { referenceFace: face } : {}),
      ...serializeEdgeFinish(values),
    };
  },
};
