/** Fillet, as Onshape's: Entities to fillet, Tangent propagation, Radius, Variable fillet with
 *  its end radius. Edge picking and the saved-document scopes live in edge-finish.ts. */
import { edgeFinishControls, layoutEdgeFinish, serializeEdgeFinish, validateEdgeFinish } from "./edge-finish";
import { checkRow, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

export const filletEditor: FeatureEditor = {
  type: "fillet",

  controls(context: FeatureEditorContext): Controls {
    const { field, feature } = context;
    return {
      ...edgeFinishControls(context),
      radius: field("Radius (mm)", String(feature?.radiusMillimeters ?? 0.5)),
      variable: field("Variable fillet", String(feature?.endRadiusMillimeters !== undefined), ["false", "true"]),
      endRadius: field("End radius (mm)", String(feature?.endRadiusMillimeters ?? feature?.radiusMillimeters ?? 0.5)),
    };
  },

  layout(context, controls) {
    const { win, form, lengthUnitLabel } = context;
    layoutEdgeFinish(context, controls, "Entities to fillet");
    const row = (label: string, control: Controls[string]) => { control.closest("label")?.remove(); control.setAttribute("form", form.id); return win.body.appendChild(rowIn(label, control, unitSuffix(lengthUnitLabel))); };
    row("Radius", controls.radius);
    const end = row("End radius", controls.endRadius);
    const sync = () => { end.hidden = controls.variable.value !== "true"; };
    win.body.insertBefore(checkRow(context, controls.variable, "Variable fillet", sync), end); sync();
    const note = document.createElement("p"); note.textContent = "A variable fillet runs from the radius at the edge's start to the end radius at its far end."; win.addHelp(note);
  },

  validate(controls) {
    if (!(Number(controls.radius.value) > 0)) return "Enter a positive radius.";
    if (controls.variable.value === "true" && !(Number(controls.endRadius.value) > 0)) return "Enter a positive end radius.";
    return validateEdgeFinish(controls, "fillet");
  },

  serialize(values) {
    return {
      radiusMillimeters: Number(values.radius),
      ...(values.variable === "true" ? { endRadiusMillimeters: Number(values.endRadius) } : {}),
      ...serializeEdgeFinish(values),
    };
  },
};
