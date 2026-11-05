import { regionControls, layoutRegion, selectedRegion } from "./regions";
import { sketchRegions, rollbackPosition } from "@aether/core/document";
import { cadWorkspace } from "../cad-workspace-store";
import { transformEdgePicker } from "./transform-edge-picker";
import { sketchDirectionLines } from "../modeling/extrude-direction-reference";
import { extrusionPointPicker, serializeExtrusionPoint } from "./extrude-point-picker";
import { extrusionPartPicker } from "./extrude-part-picker";
import { extrusionFacePicker } from "./planar-face-picker";
import { layoutExtrudeScope } from "./extrude-scope";
/** Revolve feature editor — window layout, controls, and serialization.
 *  Layout mirrors `core/ui/gallery/features/revolve.ts`: body/boolean tabs, a
 *  regions box, an axis box, then the Full-revolve toggle. */
import {
  bodyAndOperationTabs,
  entityChips,
  iconButton,
  rowIn,
  unitSuffix,
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
const endTypes = ["blind", "up-to-next", "up-to-face", "up-to-part", "up-to-vertex"] as const;
const endLabels = { Blind: "blind", "Up to next": "up-to-next", "Up to face": "up-to-face", "Up to part": "up-to-part", "Up to vertex": "up-to-vertex" } as const;
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
      // Each end stops Blind at its angle or at the next part, a face, a part or a vertex (Onshape).
      endType: field("End condition", feature?.endType ?? "blind", [...endTypes]),
      endPoint: field("Stopping point", feature?.endPointReference ? JSON.stringify(feature.endPointReference) : ""),
      endPart: field("Stopping part identity", feature?.endPartId ?? ""),
      endReference: field("Stopping face", feature?.endReference ? JSON.stringify(feature.endReference) : ""),
      angle: field("Angle (degrees)", String(feature?.angleDegrees ?? 360)),
      symmetric: field("Symmetric", String(feature?.symmetric ?? false), ["false", "true"]),
      reversed: field("Reverse direction", String(feature?.reversed ?? false), ["false", "true"]),
      offsetOn: field("Offset", feature?.endOffsetMillimeters ? "yes" : "no", ["no", "yes"]),
      endOffset: field("Offset distance (mm)", String(Math.abs(feature?.endOffsetMillimeters ?? 1))),
      offsetFlip: field("Flip offset", (feature?.endOffsetMillimeters ?? 0) < 0 ? "yes" : "no", ["no", "yes"]),
      secondEnd: field("Second end position", String(Boolean(feature?.secondEnd || feature?.secondAngleDegrees)), ["false", "true"]),
      secondEndType: field("Opposite end condition", feature?.secondEnd?.endType ?? "blind", [...endTypes]),
      secondPoint: field("Opposite stopping point", feature?.secondEnd?.endPointReference ? JSON.stringify(feature.secondEnd.endPointReference) : ""),
      secondPart: field("Opposite stopping part identity", feature?.secondEnd?.endPartId ?? ""),
      secondReference: field("Opposite stopping face", feature?.secondEnd?.endReference ? JSON.stringify(feature.secondEnd.endReference) : ""),
      second: field("Opposite angle (degrees)", String(feature?.secondEnd?.angleDegrees ?? feature?.secondAngleDegrees ?? 90)),
      // Merge scope, as Extrude's: every touching part, or the target plus additional parts.
      // A new revolve keeps the explicit target (the automatic scope's overlap test misreads some revolved solids; ledger: Revolve).
      // Onshape's default is Merge with all; a saved revolve with explicit parts stays explicit.
      scopeMode: field("Merge scope mode", feature ? feature.scopeMode ?? "selected" : "all", ["selected", "all"]),
      scope: field("Additional target parts", JSON.stringify(feature?.targetBodyIds?.filter((id: string) => id !== feature.targetBodyId) ?? [])),
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
    // Any line of any earlier sketch, any earlier construction Axis feature, a solid edge or a
    // principal axis can be the revolve axis (Jonathan, 2026-11-02). The source sketch's first
    // construction line is the default; everything else is picked in the viewport or the tree.
    const axis = controls.axis as HTMLSelectElement;
    const lines = () => sketchDirectionLines(doc, feature?.id);
    const earlierAxes = () => {
      const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : rollbackPosition(doc);
      return doc.features.slice(0, Math.max(0, end)).filter((f) => f.type === "axis" && !f.suppressed);
    };
    const rebuildAxis = () => {
      const current = axis.value;
      const all = lines();
      const defaultLine = all.find((line) => line.sourceFeatureId === controls.source.value && doc.features.find((f) => f.id === line.sourceFeatureId && f.type === "profile" && f.profile.type === "drawing" && f.profile.contours[line.contourIndex]?.construction));
      axis.replaceChildren();
      const add = (value: string, text: string) => { const option = document.createElement("option"); option.value = value; option.textContent = text; axis.append(option); };
      add("", "");
      for (const line of all) add(lineKey(line), line.label);
      for (const item of earlierAxes()) add(`axis:${item.id}`, item.name);
      add("edge", "Picked solid edge");
      for (const name of principalAxes) add(name, `${name} axis`);
      const keys = [...axis.options].map((option) => option.value);
      axis.value = keys.includes(current) && current ? current : (defaultLine ? lineKey(defaultLine) : "");
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
      axis.value = lineKey(line); axis.dataset.selectionLabel = line.label; axis.dispatchEvent(new Event("change"));
      event.preventDefault();
    };
    window.addEventListener("aether-sketch-curve-picked", curvePicked);
    // A construction Axis feature picked in the tree.
    const unsubscribeTree = cadWorkspace.subscribe(() => {
      if (!win.panel.isConnected) return;
      for (const id of cadWorkspace.snapshot().selectedItemIDs) {
        const picked = /^feature\/axis\/(.+)$/.exec(id)?.[1];
        if (picked && [...axis.options].some((option) => option.value === `axis:${picked}`) && axis.value !== `axis:${picked}`) { axis.value = `axis:${picked}`; axis.dispatchEvent(new Event("change")); }
      }
    });
    const observer = new window.MutationObserver(() => { if (win.panel.isConnected) return; observer.disconnect(); unsubscribeTree(); window.removeEventListener("aether-sketch-curve-picked", curvePicked); });
    observer.observe(document.body, { childList: true, subtree: true });
    axis.addEventListener("change", () => { if (axis.value !== "edge") axis.dataset.selectionLabel = axis.selectedOptions[0]?.textContent ?? ""; });
    controls.source.addEventListener("change", rebuildAxis);
    rebuildAxis();

    const full = document.createElement("input");
    full.type = "checkbox";
    full.setAttribute("aria-label", "Full revolve");
    win.row("Full revolve", full);

    // Not a full revolve: each end has Onshape's end type with its angle or its stopping
    // face, part or point; the first end also flips, and Blind ends can be symmetric.
    const options = document.createElement("div"); options.className = "cad-revolve-options"; win.body.append(options);
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    const layoutEnd = (into: HTMLElement, type: Controls[string], angleRow: HTMLElement, point: Controls[string], part: Controls[string], face: Controls[string], opposite: boolean, beside?: HTMLElement) => {
      hide(type);
      const prefix = opposite ? "Opposite " : "", label = (text: string) => prefix + (opposite ? text.toLowerCase() : text);
      const picker = win.picker(Object.keys(endLabels), { ariaLabel: label("End type"), onChange: (value) => { type.value = endLabels[value as keyof typeof endLabels]; sync(); type.dispatchEvent(new Event("change")); } });
      picker.setValue(Object.keys(endLabels).find((key) => endLabels[key as keyof typeof endLabels] === type.value) ?? "Blind");
      const pointPicker = extrusionPointPicker(context, point, label("Stopping point"), "Stops at the plane through this point and the axis. Changed or ambiguous vertices require reselection.");
      const partPicker = extrusionPartPicker(context, part, label("Stopping part"));
      const facePicker = extrusionFacePicker(context, face, label("Stopping face"));
      // The end type and, for the first end, the flip sit on one row like Onshape's.
      const head = document.createElement("div"); head.className = "cad-revolve-end"; head.append(picker.element, ...(beside ? [beside] : []));
      into.append(head, angleRow, facePicker.element, partPicker.element, pointPicker.element);
      return (enabled: boolean) => {
        const mode = type.value;
        angleRow.hidden = mode !== "blind";
        pointPicker.setEnabled(enabled && mode === "up-to-vertex"); partPicker.setEnabled(enabled && mode === "up-to-part"); facePicker.setEnabled(enabled && mode === "up-to-face");
      };
    };
    controls.angle.closest("label")?.remove(); controls.angle.setAttribute("form", form.id);
    const angleRow = win.row("Revolve angle", controls.angle);
    const flip = iconButton("flip-horizontal", "Flip revolve direction");
    hide(controls.reversed);
    const paintFlip = () => flip.setAttribute("aria-pressed", String(controls.reversed.value === "true"));
    flip.onclick = () => { controls.reversed.value = controls.reversed.value === "true" ? "false" : "true"; paintFlip(); controls.reversed.dispatchEvent(new Event("change")); };
    paintFlip();
    const syncFirst = layoutEnd(options, controls.endType, angleRow, controls.endPoint, controls.endPart, controls.endReference, false, flip);
    hide(controls.symmetric);
    const symmetric = document.createElement("input"); symmetric.type = "checkbox"; symmetric.setAttribute("aria-label", "Symmetric"); symmetric.checked = controls.symmetric.value === "true";
    const symmetricRow = win.row("Symmetric", symmetric); options.append(symmetricRow);
    symmetric.onchange = () => { controls.symmetric.value = String(symmetric.checked); sync(); controls.symmetric.dispatchEvent(new Event("change")); };
    hide(controls.secondEnd);
    const secondSection = win.subsection("Second end position", { kind: "checkbox", open: controls.secondEnd.value === "true", onToggle: (value) => { controls.secondEnd.value = String(value); sync(); controls.secondEnd.dispatchEvent(new Event("change")); } });
    options.append(secondSection.element);
    controls.second.closest("label")?.remove(); controls.second.setAttribute("form", form.id);
    const syncSecond = layoutEnd(secondSection.body, controls.secondEndType, win.row("Opposite angle", controls.second), controls.secondPoint, controls.secondPart, controls.secondReference, true);
    // Onshape's Offset for the Up-to end types: the sweep stops this far short of its entity (flipped: beyond it).
    hide(controls.offsetOn); hide(controls.offsetFlip);
    const offset = win.subsection("Offset", { kind: "checkbox", open: controls.offsetOn.value === "yes", onToggle: (open) => { controls.offsetOn.value = open ? "yes" : "no"; controls.offsetOn.dispatchEvent(new Event("change")); } });
    controls.endOffset.closest("label")?.remove(); controls.endOffset.setAttribute("form", form.id);
    const offsetFlip = iconButton("flip-horizontal", "Flip offset");
    const paintOffsetFlip = () => offsetFlip.setAttribute("aria-pressed", String(controls.offsetFlip.value === "yes"));
    offsetFlip.onclick = () => { controls.offsetFlip.value = controls.offsetFlip.value === "yes" ? "no" : "yes"; paintOffsetFlip(); controls.offsetFlip.dispatchEvent(new Event("change")); };
    paintOffsetFlip();
    offset.body.append(rowIn("Offset distance", controls.endOffset, unitSuffix(context.lengthUnitLabel), offsetFlip));
    options.append(offset.element);
    layoutExtrudeScope(context, controls);
    full.checked = controls.endType.value === "blind" && Math.abs(degrees(controls.angle) - 360) < 1e-9;
    function sync() {
      options.hidden = full.checked;
      const blind = controls.endType.value === "blind", second = controls.secondEnd.value === "true" && controls.symmetric.value !== "true";
      symmetricRow.hidden = !blind || controls.secondEnd.value === "true";
      secondSection.element.hidden = controls.symmetric.value === "true";
      offset.element.hidden = blind;
      syncFirst(!full.checked); syncSecond(!full.checked && second);
    }
    full.onchange = () => {
      if (full.checked) { setDegrees(controls.angle, 360); controls.endType.value = "blind"; }
      else if (degrees(controls.angle) === 360) setDegrees(controls.angle, 90);
      sync(); controls.angle.dispatchEvent(new Event("change"));
    };
    sync();
  },

  validate(controls, context) {
    const end = (type: string, angle: number, point: string, part: string, face: string, label: string) => {
      if (type === "blind" && (!Number.isFinite(angle) || angle <= 0 || angle > 360)) return `Enter a positive ${label}angle of at most 360 degrees.`;
      if (type === "up-to-vertex" && !point) return `Select the ${label}stopping point.`;
      if (type === "up-to-part" && !part) return `Select the ${label}stopping part.`;
      if (type === "up-to-face" && !face) return `Select the ${label}stopping face.`;
      return null;
    };
    const first = end(controls.endType.value, degrees(controls.angle), controls.endPoint.value, controls.endPart.value, controls.endReference.value, "");
    if (first) return first;
    const hasSecond = controls.secondEnd.value === "true" && controls.symmetric.value !== "true";
    if (hasSecond) {
      const second = end(controls.secondEndType.value, degrees(controls.second), controls.secondPoint.value, controls.secondPart.value, controls.secondReference.value, "opposite ");
      if (second) return second;
      if (controls.endType.value === "blind" && controls.secondEndType.value === "blind" && degrees(controls.angle) + degrees(controls.second) > 360) return "Revolve angles must total at most 360 degrees.";
    }
    const sketch = context.doc.features.find(feature => feature.id === controls.source.value);
    if (sketch && (!sketchRegions(sketch, false, context.doc.features).length || !controls.region.value)) return "Choose a closed sketch region.";
    if (controls.axis.value === "edge" && !controls.axisEdge.value) return "Pick a straight edge as the revolve axis.";
    if (!controls.axis.value) return "Choose a revolve axis.";
    if (controls.endType.value !== "blind" && controls.offsetOn.value === "yes" && !(Number(controls.endOffset.value) > 0)) return "Enter a positive offset distance.";
    return requireSelections(controls, [{ key: "source", noun: "a sketch region to revolve" }]);
  },

  serialize(values, context) {
    const axisReference = values.axis.startsWith("line:") ? JSON.parse(values.axis.slice(5))
      : values.axis.startsWith("axis:") ? { kind: "feature", featureId: values.axis.slice(5) }
      : values.axis === "edge" && values.axisEdge ? JSON.parse(values.axisEdge) : undefined;
    const stop = (type: string, point: string, part: string, face: string) => ({
      ...(type === "up-to-vertex" ? { endPointReference: serializeExtrusionPoint(point, context) } : {}),
      ...(type === "up-to-part" ? { endPartId: part } : {}),
      ...(type === "up-to-face" ? { endReference: JSON.parse(face) } : {}),
    });
    const blind = values.endType === "blind", full = blind && Number(values.angle) >= 360;
    const symmetric = blind && !full && values.symmetric === "true";
    return {
      ...(axisReference ? { axisReference } : {}),
      profileFeatureId: values.source,
      ...selectedRegion(values, context),
      operation: values.operation,
      ...(values.operation !== "new" && values.scopeMode === "all" ? { scopeMode: "all" } : {}),
      ...(values.scopeMode !== "all" && ["add", "cut"].includes(values.operation) && JSON.parse(values.scope || "[]").length ? { targetBodyIds: [values.target, ...JSON.parse(values.scope)] } : {}),
      axis: (principalAxes as readonly string[]).includes(values.axis) ? values.axis : "Z",
      angleDegrees: Number(values.angle),
      ...(blind ? {} : { endType: values.endType, ...stop(values.endType, values.endPoint, values.endPart, values.endReference), ...(values.offsetOn === "yes" ? { endOffsetMillimeters: Number(values.endOffset) * (values.offsetFlip === "yes" ? -1 : 1) } : {}) }),
      ...(symmetric ? { symmetric: true } : {}),
      ...(!full && values.reversed === "true" ? { reversed: true } : {}),
      ...(!full && !symmetric && values.secondEnd === "true" ? { secondEnd: {
        endType: values.secondEndType,
        ...(values.secondEndType === "blind" ? { angleDegrees: Number(values.second) } : {}),
        ...stop(values.secondEndType, values.secondPoint, values.secondPart, values.secondReference),
      } } : {}),
    };
  },
};
