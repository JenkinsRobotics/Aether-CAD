import { availableBodies, type SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { mountPartBox } from "./part-box";
import { regionControls, layoutRegion, selectedRegion } from "./regions";
import { sketchRegions } from "@aether/core/document";
import { bodyAndOperationTabs, entityChips, iconButton, layoutParameterRows, planned, requireSelections, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";
import { layoutThin, serializeThin, thinControls, validateThin } from "./extrude-thin";

const operationValues = ["new", "add", "cut"] as const;

export const sweepEditor: FeatureEditor = {
  type: "sweep",

  controls(context: FeatureEditorContext): Controls {
    const { field, reference, feature, doc } = context;
    const profile = reference("Sketch Profile", ["sketch", "profile"], feature?.profileFeatureId);
    return {
      ...thinControls(context),
      profile,
      region: regionControls(context, profile),
      path: reference("Sweep Path", ["sketch", "profile", "curve3d"], feature?.pathFeatureId),
      pathReversed: field("Path opposite direction", feature?.reversedPath ? "true" : "false", ["false", "true"]),
      twistOn: field("Twist", feature?.twist ? "yes" : "no", ["no", "yes"]),
      twistBy: field("Twist by", feature?.twist && "pitchMillimeters" in feature.twist ? "pitch" : "turns", ["turns", "angle", "pitch"]),
      twistTurns: field("Turns", String(Math.abs(feature?.twist && "turns" in feature.twist ? feature.twist.turns : 1))),
      twistAngle: field("Twist angle (degrees)", String(Math.abs(feature?.twist && "turns" in feature.twist ? feature.twist.turns : 0.25) * 360)),
      twistPitch: field("Pitch (mm)", String(feature?.twist && "pitchMillimeters" in feature.twist ? feature.twist.pitchMillimeters : 40)),
      twistReversed: field("Opposite twist direction", (feature?.twist ? ("turns" in feature.twist ? feature.twist.turns < 0 : Boolean(feature.twist.reversed)) : false) ? "true" : "false", ["false", "true"]),
      orientation: field("Orientation", typeof feature?.orientation === "object" ? (feature.orientation.kind === "support" ? "lock-faces" : "direction") : feature?.orientation ?? "perpendicular", ["perpendicular", "parallel", "lock-faces", "direction"]),
      supportFace: field("Support face", JSON.stringify(typeof feature?.orientation === "object" && feature.orientation.kind === "support" ? [feature.orientation.face] : [])),
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
    bodyAndOperationTabs(win, form, controls.operation, operationValues, controls.creationMode);
    entityChips(win, "Faces and sketch regions to sweep", controls.profile, form);
    layoutRegion(context, controls.profile, controls.region);
    const path = entityChips(win, "Sweep path", controls.path, form);
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    hide(controls.pathReversed);
    // Onshape's Opposite direction beside the path: the sweep runs from the path's other end.
    const pathFlip = iconButton("flip-horizontal", "Opposite direction");
    const paintPath = () => pathFlip.setAttribute("aria-pressed", controls.pathReversed.value);
    pathFlip.onclick = () => { controls.pathReversed.value = controls.pathReversed.value === "true" ? "false" : "true"; paintPath(); controls.pathReversed.dispatchEvent(new Event("change")); };
    paintPath(); path.element.append(pathFlip);
    // Only these controls retain automatic rows; the others are placed below in
    // entity boxes or conditional sections. Moving them twice leaves empty rows.
    const rows = layoutParameterRows(context, (control) => ![controls.upX, controls.upY, controls.upZ].includes(control));
    hide(controls.orientation); hide(controls.endScale);
    // Profile control: None (square to the path) / Keep profile orientation (as drawn) / Lock profile faces (gap) / Lock profile direction (a fixed up direction).
    const modes = { None: "perpendicular", "Keep profile orientation": "parallel", "Lock profile faces": "lock-faces", "Lock profile direction": "direction" } as const;
    const picker = win.picker(Object.keys(modes), { ariaLabel: "Profile control menu", onChange: (text) => { controls.orientation.value = modes[text as keyof typeof modes]; sync(); controls.orientation.dispatchEvent(new Event("change")); } });
    picker.setValue(Object.keys(modes).find((key) => modes[key as keyof typeof modes] === controls.orientation.value) ?? "None");
    win.body.append(rowIn("Profile control", picker.element));
    // Lock profile faces: the face the path runs along; the profile keeps its angle to it.
    const support = mountPickedReferences<SolidFaceReference>(context, controls.supportFace, {
      title: "Faces to lock to", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      onChange: (picked) => { if (picked.length > 1) support.update([picked[picked.length - 1]]); },
    });
    picker.element.closest(".aui-feature-row")!.after(support.element);
    // Twist: the profile turns about the path by turns or an angle over the whole path.
    for (const key of ["twistOn", "twistBy", "twistReversed"]) hide(controls[key]);
    const twist = win.subsection("Twist", { kind: "checkbox", open: controls.twistOn.value === "yes", onToggle: (open) => { controls.twistOn.value = open ? "yes" : "no"; controls.twistOn.dispatchEvent(new Event("change")); } });
    const check = (label: string) => { const input = document.createElement("input"); input.type = "checkbox"; input.setAttribute("aria-label", label); return input; };
    const byLabels = { Turns: "turns", Angle: "angle", Pitch: "pitch" } as const;
    const by = win.picker(Object.keys(byLabels), { ariaLabel: "Twist by menu", onChange: (text) => { controls.twistBy.value = byLabels[text as keyof typeof byLabels]; syncTwist(); controls.twistBy.dispatchEvent(new Event("change")); } });
    by.setValue(controls.twistBy.value === "pitch" ? "Pitch" : "Turns");
    for (const key of ["twistTurns", "twistAngle", "twistPitch"]) { controls[key].closest("label")?.remove(); controls[key].setAttribute("form", form.id); }
    const turnsRow = rowIn("Turns", controls.twistTurns), angleRow = rowIn("Angle", controls.twistAngle, unitSuffix(context.angleUnitLabel)), pitchRow = rowIn("Pitch", controls.twistPitch, unitSuffix(context.lengthUnitLabel));
    const twistFlip = check("Opposite twist direction"); twistFlip.checked = controls.twistReversed.value === "true";
    twistFlip.onchange = () => { controls.twistReversed.value = String(twistFlip.checked); controls.twistReversed.dispatchEvent(new Event("change")); };
    twist.body.append(rowIn("Twist by", by.element), turnsRow, angleRow, pitchRow, rowIn("Opposite direction", twistFlip));
    const syncTwist = () => { turnsRow.hidden = controls.twistBy.value !== "turns"; angleRow.hidden = controls.twistBy.value !== "angle"; pitchRow.hidden = controls.twistBy.value !== "pitch"; };
    syncTwist();
    win.body.append(twist.element);
    // Scale: the profile's size at the end of the path.
    const scale = win.subsection("Scale", { kind: "checkbox", open: Math.abs(Number(controls.endScale.value) - 1) > 1e-9, onToggle: (open) => { if (!open) { controls.endScale.value = "1"; controls.endScale.dispatchEvent(new Event("change")); } } });
    scale.body.append(rowIn("Scale factor", controls.endScale));
    win.body.append(scale.element);
    // Thin: the wall thicknesses (Extrude's rows); Trim ends stays a named gap.
    layoutThin(context, controls);
    const trim = check("Trim ends"); win.body.append(planned(rowIn("Trim ends", trim), "Not available in this kernel: trimming a thin sweep's ends square to the path is a recorded gap."));
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
      support.element.hidden = controls.orientation.value !== "lock-faces";
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
    if (controls.orientation.value === "lock-faces" && !JSON.parse(controls.supportFace.value || "[]").length) return "Pick the face the path runs along to lock the profile to.";
    if (controls.operation.value !== "new" && !JSON.parse(controls.mergeScope.value || "[]").length) return "Select the merge scope part.";
    if (controls.orientation.value === "direction" && Math.hypot(Number(controls.upX.value), Number(controls.upY.value), Number(controls.upZ.value)) < 1e-9) return "Enter a nonzero up direction.";
    if (controls.rail.value && controls.rail.value === controls.path.value) return "Choose a rail sketch other than the path.";
    const thin = validateThin(controls); if (thin) return thin;
    if (controls.twistOn.value === "yes") {
      const turns = controls.twistBy.value === "pitch" ? (Number(controls.twistPitch.value) > 0 ? 1 : 0) : controls.twistBy.value === "angle" ? Number(controls.twistAngle.value) / 360 : Number(controls.twistTurns.value);
      if (!(turns > 0 && turns <= 100)) return controls.twistBy.value === "pitch" ? "Enter a positive pitch." : "Enter a positive twist (up to 100 turns).";
      if (controls.rail.value) return "A sweep takes a twist or a guide rail, not both.";
    }
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
      ...(values.orientation === "parallel" ? { orientation: "parallel" } : values.orientation === "direction" ? { orientation: { kind: "direction", direction: [Number(values.upX), Number(values.upY), Number(values.upZ)] } }
        : values.orientation === "lock-faces" ? { orientation: { kind: "support", face: (() => { const f = JSON.parse(values.supportFace)[0]; delete f.centerMillimeters; return f; })() } } : {}),
      ...(Math.abs(Number(values.endScale) - 1) > 1e-9 ? { endScale: Number(values.endScale) } : {}),
      ...(values.rail ? { rail: { pathFeatureId: values.rail } } : {}),
      ...(values.pathReversed === "true" ? { reversedPath: true } : {}),
      ...(values.twistOn === "yes" ? { twist: values.twistBy === "pitch" ? { pitchMillimeters: Number(values.twistPitch), ...(values.twistReversed === "true" ? { reversed: true } : {}) } : { turns: (values.twistBy === "angle" ? Number(values.twistAngle) / 360 : Number(values.twistTurns)) * (values.twistReversed === "true" ? -1 : 1) } } : {}),
      ...serializeThin(values),
      operation: values.operation,
      ...(values.operation !== "new" ? { targetBodyId: JSON.parse(values.mergeScope || "[]")[0] } : {}),
    };
  },
};
