import { regionControls, layoutRegion, selectedRegion } from "./regions";
import { sketchRegions } from "@aether/core/document";
import { transformEdgePicker } from "./transform-edge-picker";
import { sketchDirectionLines } from "../modeling/extrude-direction-reference";
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

const principalAxes = ["X", "Y", "Z"] as const;
const lineKey = (line: { sourceFeatureId: string; contourId?: string; segmentId?: string }) =>
  `line:${JSON.stringify({ kind: "sketch-line", sourceFeatureId: line.sourceFeatureId, contourId: line.contourId, segmentId: line.segmentId })}`;

export const revolveEditor: FeatureEditor = {
  type: "revolve",

  controls(context: FeatureEditorContext): Controls {
    const { field, reference, feature, doc } = context;
    const source = reference("Sketch", ["sketch", "profile"], feature?.profileFeatureId);
    const saved = feature?.axisReference;
    // One axis choice (Jonathan, 2026-11-01): a straight line of the sketch (construction
    // lines first, as the axis is usually drawn that way), a picked solid edge, or a
    // principal axis. The list is rebuilt when the sketch changes.
    const axisValue = saved?.kind === "sketch-line" ? lineKey(saved) : saved?.kind === "solid-edge" ? "edge" : (feature?.axis ?? "");
    return {
      source,
      region: regionControls(context, source),
      operation: field(
        "Operation",
        feature?.operation ??
          (doc.features.some((f) => ["extrude", "revolve"].includes(f.type)) ? "add" : "new"),
        [...operationValues],
      ),
      // The box reads "Revolve axis"; the list inside it has its own accessible name for the suite and agents.
      axis: field("Revolve axis choice", axisValue, [axisValue, "edge", ...principalAxes]),
      axisEdge: field("Axis edge", JSON.stringify(saved?.kind === "solid-edge" ? saved : "")),
      endType: field("End type", "blind", ["blind"]),
      angle: field("Angle (degrees)", String(feature?.angleDegrees ?? 360)),
      symmetric: field("Symmetric", String(feature?.symmetric ?? false), ["false", "true"]),
      reversed: field("Reverse direction", String(feature?.reversed ?? false), ["false", "true"]),
      secondEnd: field("Second end position", String((feature?.secondAngleDegrees ?? 0) > 0), ["false", "true"]),
      second: field("Opposite angle (degrees)", String(feature?.secondAngleDegrees ?? 0)),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, doc, feature } = context;
    bodyAndOperationTabs(win, form, controls.operation, operationValues);
    entityChips(win, "Faces and sketch regions to revolve", controls.source, form);
    layoutRegion(context, controls.source, controls.region);

    // Revolve axis: a selection box like the regions box (Jonathan, 2026-11-01), filled by
    // clicking a line of the sketch or a solid edge in the viewport; its list (the sketch's
    // lines, construction first, then the principal axes) shows only while it is empty.
    const axis = controls.axis as HTMLSelectElement;
    const lines = () => sketchDirectionLines(doc, feature?.id).filter((line) => line.sourceFeatureId === controls.source.value);
    const rebuildAxis = () => {
      const current = axis.value;
      const all = lines();
      const ordered = [...all.filter((line) => /Construction/.test(line.label)), ...all.filter((line) => !/Construction/.test(line.label))];
      axis.replaceChildren();
      const add = (value: string, text: string) => { const option = document.createElement("option"); option.value = value; option.textContent = text; axis.append(option); };
      add("", "Click a sketch line or an edge");
      for (const line of ordered) add(lineKey(line), line.label.replace(/^.*? · /, ""));
      add("edge", "Picked solid edge");
      for (const name of principalAxes) add(name, `${name} axis`);
      const keys = [...axis.options].map((option) => option.value);
      axis.value = keys.includes(current) && current ? current : (ordered[0] ? lineKey(ordered[0]) : "");
      axis.dataset.selectionLabel = axis.value === "edge" ? edgeLabel() : (axis.selectedOptions[0]?.textContent ?? "");
      axis.dispatchEvent(new Event("change"));
    };
    const edgeLabel = () => { try { return JSON.parse(controls.axisEdge.value || '""')?.label || "Solid edge"; } catch { return "Solid edge"; } };
    entityChips(win, "Revolve axis", axis, form);
    const edgePicker = transformEdgePicker(context, controls.axisEdge);
    edgePicker.setEnabled(true); edgePicker.element.style.display = "none";
    controls.axisEdge.addEventListener("change", () => {
      if (!controls.axisEdge.value) return;
      axis.value = "edge"; axis.dataset.selectionLabel = edgeLabel(); axis.dispatchEvent(new Event("change"));
    });
    const curvePicked = (event: Event) => {
      if (!win.panel.isConnected) return;
      const picked = (event as CustomEvent).detail as { sourceFeatureId: string; contourId: string; segmentId: string };
      const line = lines().find((item) => item.sourceFeatureId === picked.sourceFeatureId && item.contourId === picked.contourId && item.segmentId === picked.segmentId);
      if (!line) return;
      axis.value = lineKey(line); axis.dataset.selectionLabel = line.label.replace(/^.*? · /, ""); axis.dispatchEvent(new Event("change"));
    };
    window.addEventListener("aether-sketch-curve-picked", curvePicked);
    const observer = new window.MutationObserver(() => { if (win.panel.isConnected) return; observer.disconnect(); window.removeEventListener("aether-sketch-curve-picked", curvePicked); });
    observer.observe(document.body, { childList: true, subtree: true });
    axis.addEventListener("change", () => { if (axis.value !== "edge") axis.dataset.selectionLabel = axis.selectedOptions[0]?.textContent ?? ""; });
    controls.source.addEventListener("change", rebuildAxis);
    rebuildAxis();

    const full = document.createElement("input");
    full.type = "checkbox";
    full.setAttribute("aria-label", "Full revolve");
    win.row("Full revolve", full);

    // Not a full revolve: Onshape's end type, angle with a flip, symmetric and a second end.
    const options = document.createElement("div"); options.className = "cad-revolve-options"; win.body.append(options);
    controls.endType.closest("label")?.remove(); controls.endType.setAttribute("form", form.id);
    for (const option of (controls.endType as HTMLSelectElement).options) option.textContent = "Blind";
    options.append(win.row("End type", controls.endType));
    controls.angle.closest("label")?.remove(); controls.angle.setAttribute("form", form.id);
    const angleRow = win.row("Revolve angle", controls.angle); options.append(angleRow);
    const flip = document.createElement("button"); flip.type = "button"; flip.className = "aui-icon-button"; flip.textContent = "⇄";
    flip.setAttribute("aria-label", "Flip revolve direction"); flip.title = "Flip direction";
    angleRow.append(flip);
    controls.reversed.closest("label")?.remove(); controls.reversed.hidden = true; controls.reversed.setAttribute("form", form.id); form.append(controls.reversed);
    const paintFlip = () => flip.setAttribute("aria-pressed", String(controls.reversed.value === "true"));
    flip.onclick = () => { controls.reversed.value = controls.reversed.value === "true" ? "false" : "true"; paintFlip(); controls.reversed.dispatchEvent(new Event("change")); };
    paintFlip();
    const checkRow = (key: string, label: string) => {
      const control = controls[key]; control.closest("label")?.remove();
      control.hidden = true; control.setAttribute("form", form.id); form.append(control);
      const check = document.createElement("input"); check.type = "checkbox";
      check.setAttribute("aria-label", label); check.checked = control.value === "true";
      const row = win.row(label, check); options.append(row);
      check.onchange = () => { control.value = String(check.checked); sync(); control.dispatchEvent(new Event("change")); };
      return check;
    };
    checkRow("symmetric", "Symmetric");
    const secondEnd = checkRow("secondEnd", "Second end position");
    controls.second.closest("label")?.remove(); controls.second.setAttribute("form", form.id);
    const secondRow = win.row("Second end angle", controls.second); options.append(secondRow);
    full.checked = Math.abs(degrees(controls.angle) - 360) < 1e-9;
    function sync() {
      options.hidden = full.checked;
      secondRow.hidden = controls.symmetric.value === "true" || !secondEnd.checked;
      secondEnd.disabled = controls.symmetric.value === "true";
    }
    controls.symmetric.addEventListener("change", sync);
    full.onchange = () => {
      if (full.checked) { setDegrees(controls.angle, 360); setDegrees(controls.second, 0); }
      else if (degrees(controls.angle) === 360) setDegrees(controls.angle, 90);
      sync(); controls.angle.dispatchEvent(new Event("change"));
    };
    sync();
  },

  validate(controls, context) {
    const angle = degrees(controls.angle);
    const second = controls.symmetric.value === "true" || controls.secondEnd.value !== "true" ? 0 : degrees(controls.second);
    if (!controls.angle.value.trim() || !Number.isFinite(angle) || angle <= 0 || !Number.isFinite(second) || second < 0 || angle + second > 360)
      return "Enter positive revolve angles totaling at most 360 degrees.";
    const sketch = context.doc.features.find(feature => feature.id === controls.source.value);
    if (sketch && (!sketchRegions(sketch, false, context.doc.features).length || !controls.region.value)) return "Choose a closed sketch region.";
    if (controls.axis.value === "edge" && !controls.axisEdge.value) return "Pick a straight edge as the revolve axis.";
    if (!controls.axis.value) return "Choose a revolve axis.";
    return requireSelections(controls, [{ key: "source", noun: "a sketch region to revolve" }]);
  },

  serialize(values, context) {
    const second = values.symmetric === "true" || values.secondEnd !== "true" ? 0 : Number(values.second);
    const axisReference = values.axis.startsWith("line:") ? JSON.parse(values.axis.slice(5))
      : values.axis === "edge" && values.axisEdge ? JSON.parse(values.axisEdge) : undefined;
    return {
      ...(axisReference ? { axisReference } : {}),
      profileFeatureId: values.source,
      ...selectedRegion(values, context),
      operation: values.operation,
      axis: (principalAxes as readonly string[]).includes(values.axis) ? values.axis : "Z",
      angleDegrees: Number(values.angle),
      ...(Number(values.angle) < 360 && values.symmetric === "true" ? {symmetric:true} : {}),
      ...(Number(values.angle) < 360 && values.reversed === "true" ? {reversed:true} : {}),
      ...(Number(values.angle) < 360 && second > 0 ? {secondAngleDegrees:second} : {}),
    };
  },
};
