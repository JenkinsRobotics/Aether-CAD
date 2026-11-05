/** Rib, as Onshape's (help: PartStudio/rib.htm): Sketch profiles (open curves of one sketch),
 *  Parts, Thickness, Parallel / Normal to sketch plane with the flip, Draft angle, Extend profiles
 *  to part and Merge ribs. Normal to the sketch plane builds the wall centred on the curves, up to
 *  the part (Extrude's thin wall under the hood); Parallel fills in-plane from the curve to the
 *  part. The draft angle and Extend profiles to part are present and disabled with the gap named. */
import { availableBodies, sketchRegions } from "@aether/core/document";
import { mountPartBox } from "./part-box";
import { entityChips, iconButton, planned, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const draftGap = "Not available in this kernel: a drafted rib (a drafted thin extrusion) is a recorded gap.";
const extendGap = "Not available in this kernel: extending the curves' ends to the part is a recorded gap; draw the curve to the part.";
const mergeGap = "Ribs merge into the part as they are built; separate rib bodies are a recorded gap.";

export const ribEditor: FeatureEditor = {
  type: "rib",
  controls(context: FeatureEditorContext): Controls {
    const { field, reference, feature, doc } = context;
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    return {
      profile: reference("Sketch profiles", ["sketch", "profile"], feature?.profileFeatureId),
      curves: field("Rib curves", JSON.stringify(feature?.profileContourIds ?? [])),
      parts: field("Parts", JSON.stringify(feature?.targetBodyId ? [feature.targetBodyId] : bodies.at(-1) ? [bodies.at(-1)!.id] : [])),
      thickness: field("Thickness (mm)", String(feature?.thicknessMillimeters ?? 2)),
      direction: field("Rib direction", feature?.direction ?? "normal", ["normal", "parallel"]),
      reversed: field("Opposite direction", feature?.reversed ? "true" : "false", ["false", "true"]),
    };
  },
  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, doc, feature, lengthUnitLabel } = context;
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    for (const key of ["curves", "parts", "direction", "reversed"]) hide(controls[key]);
    const chips = entityChips(win, "Sketch profiles", controls.profile, form);
    // The open curves of the chosen sketch: all of them, or the ticked ones.
    const list = document.createElement("div"); list.className = "cad-rib-curves"; chips.element.append(list);
    const renderCurves = () => {
      const sketch = doc.features.find((f) => f.id === controls.profile.value);
      const open = sketch ? sketchRegions(sketch, true, doc.features).filter((r) => r.closed === false && r.contourId) : [];
      const chosen = new Set(JSON.parse(controls.curves.value || "[]") as string[]);
      list.replaceChildren(...open.map((r) => { const label = document.createElement("label"); label.className = "aui-feature-entity"; const box = document.createElement("input"); box.type = "checkbox"; box.checked = !chosen.size || chosen.has(r.contourId!); box.setAttribute("aria-label", `Use ${r.label}`);
        box.onchange = () => { const next = open.filter((o) => (o === r ? box.checked : (list.querySelector(`[aria-label="Use ${o.label}"]`) as HTMLInputElement)?.checked)).map((o) => o.contourId!); controls.curves.value = JSON.stringify(next.length === open.length ? [] : next); controls.curves.dispatchEvent(new Event("change")); };
        label.append(box, document.createTextNode(r.label)); return label; }));
      list.hidden = !open.length;
    };
    controls.profile.addEventListener("change", () => { controls.curves.value = "[]"; renderCurves(); });
    renderCurves();
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const parts = mountPartBox(context, controls.parts, "Parts", availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined }), () => "", { single: true });
    win.body.append(parts.element);
    controls.thickness.closest("label")?.remove(); controls.thickness.setAttribute("form", form.id);
    win.body.append(rowIn("Thickness", controls.thickness, unitSuffix(lengthUnitLabel)));
    // Rib direction and its flip.
    const directions = { "Normal to sketch plane": "normal", "Parallel to sketch plane": "parallel" } as const;
    const picker = win.picker(Object.keys(directions), { ariaLabel: "Rib direction menu", onChange: (text) => { controls.direction.value = directions[text as keyof typeof directions]; controls.direction.dispatchEvent(new Event("change")); } });
    picker.setValue(controls.direction.value === "parallel" ? "Parallel to sketch plane" : "Normal to sketch plane");
    const flip = iconButton("flip-horizontal", "Opposite direction");
    const paintFlip = () => flip.setAttribute("aria-pressed", controls.reversed.value);
    flip.onclick = () => { controls.reversed.value = controls.reversed.value === "true" ? "false" : "true"; paintFlip(); controls.reversed.dispatchEvent(new Event("change")); };
    paintFlip();
    win.body.append(rowIn("Rib direction", picker.element, flip));
    const gapInput = (label: string, reason: string) => { const input = document.createElement("input"); input.type = "text"; input.setAttribute("aria-label", label); return planned(rowIn(label, input), reason); };
    const gapCheck = (label: string, reason: string, checked = false) => { const box = document.createElement("input"); box.type = "checkbox"; box.checked = checked; box.setAttribute("aria-label", label); return planned(rowIn(label, box), reason); };
    const draft = win.subsection("Draft", { kind: "checkbox", open: false });
    draft.body.append(gapInput("Draft angle", draftGap));
    planned(draft.element, draftGap);
    win.body.append(draft.element, gapCheck("Extend profiles to part", extendGap), gapCheck("Merge ribs", mergeGap, true));
    const note = document.createElement("p"); note.textContent = "Normal: the wall is centred on each open curve and runs square to the sketch plane until it meets the part. Parallel: the wall stands the thickness tall across the plane and fills from the curve to the part, square to the curve's chord."; win.addHelp(note);
  },
  validate(controls, context) {
    if (!controls.profile.value) return "Choose the sketch with the rib curves.";
    const sketch = context.doc.features.find((f) => f.id === controls.profile.value);
    if (!sketch || !sketchRegions(sketch, true, context.doc.features).some((r) => r.closed === false)) return "The sketch has no open curves to build ribs from.";
    if (!JSON.parse(controls.parts.value || "[]").length) return "Select the part the rib joins.";
    if (!(Number(controls.thickness.value) > 0)) return "Enter a positive thickness.";
    return null;
  },
  serialize(values) {
    const curves = JSON.parse(values.curves || "[]") as string[];
    return { profileFeatureId: values.profile, ...(curves.length ? { profileContourIds: curves } : {}), targetBodyId: JSON.parse(values.parts)[0], thicknessMillimeters: Number(values.thickness), ...(values.direction === "parallel" ? { direction: "parallel" } : {}), ...(values.reversed === "true" ? { reversed: true } : {}) };
  },
};
