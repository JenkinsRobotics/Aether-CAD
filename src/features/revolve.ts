import { regionControls, layoutRegion, selectedRegion } from "./regions";
import { sketchRegions } from "../freecad-translate";
/** Revolve feature editor — window layout, controls, and serialization.
 *  Layout mirrors `core/ui/gallery/features/revolve.ts`: body/boolean tabs, a
 *  regions box, an axis box, then the Full-revolve toggle. */
import {
  bodyAndOperationTabs,
  entityChips,
  type Controls,
  type FeatureEditor,
  type FeatureEditorContext,
  requireSelections,
} from "./shared";

function degrees(control: Controls[string]): number {
  return control.value === control.dataset.displayValue
    ? Number(control.dataset.originalValue ?? control.value)
    : Number(control.value) * Number(control.dataset.canonicalFactor ?? 1);
}
function setDegrees(control: Controls[string], value: number) {
  control.value = String(value / Number(control.dataset.canonicalFactor ?? 1));
  control.dataset.displayValue = control.value;
  control.dataset.originalValue = String(value);
}

const operationValues = ["new", "add", "cut"] as const;

export const revolveEditor: FeatureEditor = {
  type: "revolve",

  controls(context: FeatureEditorContext): Controls {
    const { field, reference, feature, doc } = context;
    const source = reference("Sketch", ["sketch", "profile"], feature?.profileFeatureId);
    return {
      source,
      region: regionControls(context, source),
      operation: field(
        "Operation",
        feature?.operation ??
          (doc.features.some((f) => ["extrude", "revolve"].includes(f.type)) ? "add" : "new"),
        [...operationValues],
      ),
      axis: field("Axis", feature?.axis ?? "Z", ["X", "Y", "Z"]),
      angle: field("Angle (degrees)", String(feature?.angleDegrees ?? 360)),
      symmetric: field("Symmetric", String(feature?.symmetric ?? false), ["false", "true"]),
      reversed: field("Reverse direction", String(feature?.reversed ?? false), ["false", "true"]),
      second: field("Opposite angle (degrees)", String(feature?.secondAngleDegrees ?? 0)),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form } = context;
    bodyAndOperationTabs(win, form, controls.operation, operationValues);
    entityChips(win, "Faces and sketch regions to revolve", controls.source, form);

    layoutRegion(context, controls.source, controls.region);

    // The gallery shows the axis as its own entity box; this engine picks the
    // axis from a principal-axis list, so it is a row in the same position.
    controls.axis.closest("label")?.remove();
    controls.axis.setAttribute("form", form.id);
    win.row("Revolve axis", controls.axis);

    const full = document.createElement("input");
    full.type = "checkbox";
    full.setAttribute("aria-label", "Full revolve");
    win.row("Full revolve", full);

    controls.angle.closest("label")?.remove();
    controls.angle.setAttribute("form", form.id);
    const angleRow = win.row("Angle", controls.angle);
    full.checked = Math.abs(degrees(controls.angle) - 360) < 1e-9;
    angleRow.hidden = full.checked;
    const extra = document.createElement("div"); win.body.append(extra);
    for (const [key, label] of [["symmetric", "Symmetric"], ["reversed", "Reverse direction"]]) {
      const control = controls[key]; control.closest("label")?.remove();
      control.hidden = true; control.setAttribute("form", form.id); form.append(control);
      const check = document.createElement("input"); check.type = "checkbox";
      check.setAttribute("aria-label", label); check.checked = control.value === "true";
      const row = win.row(label, check); extra.append(row);
      check.onchange = () => { control.value = String(check.checked); sync(); control.dispatchEvent(new Event("change")); };
    }
    controls.second.closest("label")?.remove(); controls.second.setAttribute("form", form.id);
    const secondRow = win.row("Opposite angle", controls.second); extra.append(secondRow);
    function sync() {
      extra.hidden = full.checked;
      secondRow.hidden = controls.symmetric.value === "true";
    }
    controls.symmetric.addEventListener("change", sync);
    full.onchange = () => {
      angleRow.hidden = full.checked;
      if (full.checked) { setDegrees(controls.angle, 360); setDegrees(controls.second, 0); }
      else if (degrees(controls.angle) === 360) setDegrees(controls.angle, 90);
      sync(); controls.angle.dispatchEvent(new Event("change"));
    };
    sync();
  },

  validate(controls, context) {
    const angle = degrees(controls.angle);
    const second = controls.symmetric.value === "true" ? 0 : degrees(controls.second);
    if (!controls.angle.value.trim() || !Number.isFinite(angle) || angle <= 0 || !Number.isFinite(second) || second < 0 || angle + second > 360)
      return "Enter positive revolve angles totaling at most 360 degrees.";
    const sketch = context.doc.features.find(feature => feature.id === controls.source.value);
    if (sketch && (!sketchRegions(sketch, false, context.doc.features).length || !controls.region.value)) return "Choose a closed sketch region.";
    return requireSelections(controls, [
      { key: "source", noun: "a sketch region to revolve" },
      { key: "axis", noun: "a revolve axis" },
    ]);
  },

  serialize(values, context) {
    return {
      profileFeatureId: values.source,
      ...selectedRegion(values, context),
      operation: values.operation,
      axis: values.axis,
      angleDegrees: Number(values.angle),
      ...(Number(values.angle) < 360 && values.symmetric === "true" ? {symmetric:true} : {}),
      ...(Number(values.angle) < 360 && values.reversed === "true" ? {reversed:true} : {}),
      ...(Number(values.angle) < 360 && values.symmetric !== "true" && Number(values.second) > 0 ? {secondAngleDegrees:Number(values.second)} : {}),
    };
  },
};
