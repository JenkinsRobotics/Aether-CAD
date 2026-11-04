import { availableBodies } from "@aether/core/document";
import { mountPartBox } from "./part-box";
import { regionControls, layoutRegion, selectedRegion } from "./regions";
import { sketchRegions } from "@aether/core/document";
import { bodyAndOperationTabs, entityChips, iconButton, layoutParameterRows, planned, requireSelections, rowIn, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const operationValues = ["new", "add", "cut"] as const;

export const sweepEditor: FeatureEditor = {
  type: "sweep",

  controls(context: FeatureEditorContext): Controls {
    const { field, reference, feature, doc } = context;
    const profile = reference("Sketch Profile", ["sketch", "profile"], feature?.profileFeatureId);
    return {
      profile,
      region: regionControls(context, profile),
      path: reference("Sweep Path", ["sketch", "profile", "curve3d"], feature?.pathFeatureId),
      orientation: field("Orientation", typeof feature?.orientation === "object" ? "direction" : feature?.orientation ?? "perpendicular", ["perpendicular", "parallel", "lock-faces", "direction"]),
      upX: field("Up direction X", String(typeof feature?.orientation === "object" ? feature.orientation.direction[0] : 0)),
      upY: field("Up direction Y", String(typeof feature?.orientation === "object" ? feature.orientation.direction[1] : 0)),
      upZ: field("Up direction Z", String(typeof feature?.orientation === "object" ? feature.orientation.direction[2] : 1)),
      endScale: field("End scale", String(feature?.endScale ?? 1)),
      rail: reference("Guide rail", ["sketch", "profile", "curve3d"], feature?.rail?.pathFeatureId),
      operation: field(
        "Operation",
        feature?.operation ??
          (doc.features.some((f) => ["extrude", "revolve", "sweep"].includes(f.type)) ? "add" : "new"),
        [...operationValues],
      ),
      mergeScope: field("Merge scope part", JSON.stringify(feature?.targetBodyId ? [feature.targetBodyId] : availableBodies(doc).at(-1) ? [availableBodies(doc).at(-1)!.id] : [])),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, doc, feature } = context;
    bodyAndOperationTabs(win, form, controls.operation, operationValues);
    entityChips(win, "Faces and sketch regions to sweep", controls.profile, form);
    layoutRegion(context, controls.profile, controls.region);
    const path = entityChips(win, "Sweep path", controls.path, form);
    // Onshape's Opposite direction beside the path: a sweep starting from the path's other end is a gap.
    const pathFlip = planned(iconButton("flip-horizontal", "Opposite direction"), "Not available in this kernel: starting the sweep from the path's other end is a recorded gap.");
    path.element.append(pathFlip);
    const rows = layoutParameterRows(context, (control) => control === controls.rail || control === controls.orientation || control === controls.endScale);
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    hide(controls.orientation); hide(controls.endScale);
    // Profile control: None (square to the path) / Keep profile orientation (as drawn) / Lock profile faces (gap) / Lock profile direction (a fixed up direction).
    const modes = { None: "perpendicular", "Keep profile orientation": "parallel", "Lock profile faces": "lock-faces", "Lock profile direction": "direction" } as const;
    const picker = win.picker(Object.keys(modes), { ariaLabel: "Profile control menu", onChange: (text) => { controls.orientation.value = modes[text as keyof typeof modes]; sync(); controls.orientation.dispatchEvent(new Event("change")); } });
    picker.setValue(Object.keys(modes).find((key) => modes[key as keyof typeof modes] === controls.orientation.value) ?? "None");
    win.body.append(rowIn("Profile control", picker.element));
    // Twist is a kernel gap: present and disabled.
    const twist = win.subsection("Twist", { kind: "checkbox", open: false });
    const text = (label: string) => { const input = document.createElement("input"); input.type = "text"; input.setAttribute("aria-label", label); return input; };
    const check = (label: string) => { const input = document.createElement("input"); input.type = "checkbox"; input.setAttribute("aria-label", label); return input; };
    twist.body.append(rowIn("Twist by", text("Twist by")), rowIn("Turns", text("Turns")), rowIn("Opposite direction", check("Opposite twist direction")), rowIn("Extend to full path", check("Extend to full path")));
    planned(twist.element, "Not available in this kernel: twisting the profile along the path (turns, angle or pitch) is a recorded gap.");
    win.body.append(twist.element);
    // Scale: the profile's size at the end of the path.
    const scale = win.subsection("Scale", { kind: "checkbox", open: Math.abs(Number(controls.endScale.value) - 1) > 1e-9, onToggle: (open) => { if (!open) { controls.endScale.value = "1"; controls.endScale.dispatchEvent(new Event("change")); } } });
    scale.body.append(rowIn("Scale factor", controls.endScale));
    win.body.append(scale.element);
    const trim = check("Trim ends"); win.body.append(planned(rowIn("Trim ends", trim), "Not available in this kernel: trimming a thin sweep's ends at the path is a recorded gap (thin sweeps are a gap)."));
    // Merge scope: the part the sweep adds to or removes from.
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const merge = mountPartBox(context, controls.mergeScope, "Merge scope", bodies, () => "", { single: true });
    win.body.append(merge.element);
    controls.mergeScope.addEventListener("change", () => { const id = JSON.parse(controls.mergeScope.value || "[]")[0]; if (id) { controls.target.value = id; controls.target.dispatchEvent(new Event("change")); } });
    // Aether's own: the guide rail and the up direction.
    const more = win.subsection("Aether options", { kind: "disclosure", open: Boolean(controls.rail.value) || controls.orientation.value === "direction" });
    const rail = entityChips(win, "Guide rail (optional)", controls.rail, form); more.body.append(rail.element);
    for (const key of ["upX", "upY", "upZ"]) more.body.append(rows.get(controls[key])!);
    win.body.append(more.element);
    const sync = () => {
      for (const key of ["upX", "upY", "upZ"]) rows.get(controls[key])!.hidden = controls.orientation.value !== "direction";
      merge.element.hidden = controls.operation.value === "new";
    };
    controls.operation.addEventListener("change", sync); sync();
  },

  validate(controls, context) {
    if (controls.profile.value === controls.path.value && controls.profile.value) return "Choose a separate sketch for the sweep path.";
    const profile = context.doc.features.find(feature => feature.id === controls.profile.value);
    if (profile && (!sketchRegions(profile, false, context.doc.features).length || !controls.region.value)) return "Choose a closed profile region.";
    const endScale = Number(controls.endScale.value);
    if (!(endScale >= 0.01 && endScale <= 100)) return "End scale must be between 0.01 and 100.";
    if (controls.orientation.value === "lock-faces") return "Not available in this kernel: locking the profile to its faces along the path is a recorded gap (choose None, Keep profile orientation or Lock profile direction).";
    if (controls.operation.value !== "new" && !JSON.parse(controls.mergeScope.value || "[]").length) return "Select the merge scope part.";
    if (controls.orientation.value === "direction" && Math.hypot(Number(controls.upX.value), Number(controls.upY.value), Number(controls.upZ.value)) < 1e-9) return "Enter a nonzero up direction.";
    if (controls.rail.value && controls.rail.value === controls.path.value) return "Choose a rail sketch other than the path.";
    return requireSelections(controls, [
      { key: "profile", noun: "a sketch profile" },
      { key: "path", noun: "a sweep path" },
    ]);
  },

  serialize(values, context) {
    return {
      profileFeatureId: values.profile,
      ...selectedRegion(values, context, "profile"),
      pathFeatureId: values.path,
      ...(values.orientation === "parallel" ? { orientation: "parallel" } : values.orientation === "direction" ? { orientation: { kind: "direction", direction: [Number(values.upX), Number(values.upY), Number(values.upZ)] } } : {}),
      ...(Math.abs(Number(values.endScale) - 1) > 1e-9 ? { endScale: Number(values.endScale) } : {}),
      ...(values.rail ? { rail: { pathFeatureId: values.rail } } : {}),
      operation: values.operation,
      ...(values.operation !== "new" ? { targetBodyId: JSON.parse(values.mergeScope || "[]")[0] } : {}),
    };
  },
};
