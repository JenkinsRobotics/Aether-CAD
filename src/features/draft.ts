/** Draft, as Onshape's (help: draft.htm): the Neutral plane / Parting line tabs; Neutral plane,
 *  Entities to draft, Draft angle with its flip, Tangent propagation and Reapply fillets; under
 *  Parting line the Pull direction (a plane or planar face), Parting entities (edges), the angle
 *  and flip, One sided / Symmetric / Two sided with a second angle. Tangent propagation is always
 *  on (OCCT keeps tangent faces tangent); Reapply fillets is present and disabled with the gap
 *  named (ledger: Draft). A custom pull direction sits under Aether options. */
import type { EdgeFinishEdge, MirrorPlaneReference, SolidFaceReference } from "@aether/core/document";
import { edgeIdentity } from "./edge-finish";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { mountPlaneBox } from "./plane-box";
import { iconButton, planned, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const filletsGap = "Not available in this kernel: reapplying fillets as cones after the draft is a recorded gap.";

export const draftEditor: FeatureEditor = {
  type: "draft",
  controls({ field, feature }: FeatureEditorContext): Controls {
    return {
      mode: field("Draft mode", feature?.mode ?? "neutral", ["neutral", "parting-line"]),
      pullPlaneRef: field("Pull direction reference", feature?.pullPlane ? JSON.stringify(feature.pullPlane) : ""),
      partingEdges: field("Parting entities", JSON.stringify(feature?.partingEdges ?? [])),
      sides: field("Parting sides", feature?.sides ?? "one", ["one", "symmetric", "two"]),
      secondAngle: field("Second draft angle (degrees)", String(feature?.secondAngleDegrees ?? 5)),
      faceScope: field("Faces", feature?.faces ? "picked" : "plane", ["picked", "plane"]),
      faces: field("Picked faces", JSON.stringify(feature?.faces ?? [])),
      facePlane: field("Face plane", feature?.facePlane.plane ?? "XZ", ["XY", "XZ", "YZ"]),
      faceOffset: field("Face plane offset (mm)", String(feature?.facePlane.offsetMillimeters ?? 0)),
      neutralScope: field("Neutral", feature?.neutralFace ? "face" : feature ? "plane" : "face", ["plane", "face"]),
      neutralFace: field("Neutral face", JSON.stringify(feature?.neutralFace ? [feature.neutralFace] : [])),
      neutralPlane: field("Neutral plane", feature?.neutralPlane.plane ?? "XY", ["XY", "XZ", "YZ"]),
      neutralOffset: field("Neutral plane offset (mm)", String(feature?.neutralPlane.offsetMillimeters ?? 0)),
      angle: field("Draft angle (degrees)", String(feature?.angleDegrees ?? 5)),
      direction: field("Direction", feature?.reversed ? "reverse" : "normal", ["normal", "reverse"]),
      pullMode: field("Pull direction", feature?.pullDirection ? "custom" : "neutral", ["neutral", "custom"]),
      pullX: field("Pull X", String(feature?.pullDirection?.[0] ?? 0)), pullY: field("Pull Y", String(feature?.pullDirection?.[1] ?? 0)), pullZ: field("Pull Z", String(feature?.pullDirection?.[2] ?? 1)),
    };
  },
  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, feature, angleUnitLabel, lengthUnitLabel } = context;
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    for (const control of Object.values(controls)) hide(control);
    const row = (label: string, control: Controls[string], unit?: string) => { const r = unit ? rowIn(label, control, unitSuffix(unit)) : rowIn(label, control); control.hidden = false; win.body.append(r); return r; };
    // Neutral plane | Parting line
    const parting = () => controls.mode.value === "parting-line";
    const tabs = win.tabs(["Neutral plane", "Parting line"], parting() ? 1 : 0);
    [...tabs.children].forEach((tab, index) => { (tab as HTMLButtonElement).onclick = () => { controls.mode.value = index ? "parting-line" : "neutral"; [...tabs.children].forEach((o, i) => o.classList.toggle("active", i === index)); sync(); controls.mode.dispatchEvent(new Event("change")); }; });
    win.body.append(tabs);
    // Neutral plane first, then the entities, as Onshape's.
    const neutral = mountPickedReferences<SolidFaceReference>(context, controls.neutralFace, {
      title: "Neutral plane", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "The planar face the draft pivots about: the part keeps its size there.",
      onChange: (faces) => { if (faces.length > 1) neutral.update([faces[faces.length - 1]]); else { controls.neutralScope.value = faces.length ? "face" : "plane"; controls.neutralScope.dispatchEvent(new Event("change")); } },
    });
    const entities = mountPickedReferences<SolidFaceReference>(context, controls.faces, {
      title: "Entities to draft", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "The planar faces to tilt by the draft angle.",
      onChange: (faces) => { if (faces.length) { controls.faceScope.value = "picked"; controls.faceScope.dispatchEvent(new Event("change")); } },
    });
    // Parting line: the pull direction's plane and the parting edges.
    const pullBox = mountPlaneBox(context, controls.pullPlaneRef, "Pull direction");
    const parts = mountPickedReferences<EdgeFinishEdge>(context, controls.partingEdges, {
      title: "Parting entities", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity,
      note: "The edges the faces pivot about; each stays where it is.",
    });
    // Boxes mount by prepending: put them in Onshape's order after the tabs.
    win.body.insertBefore(neutral.element, tabs.nextSibling); win.body.insertBefore(entities.element, neutral.element.nextSibling);
    win.body.insertBefore(pullBox.element, entities.element.nextSibling); win.body.insertBefore(parts.element, pullBox.element.nextSibling);
    const angle = row("Draft angle", controls.angle, angleUnitLabel);
    const flip = iconButton("flip-horizontal", "Opposite direction");
    const paintFlip = () => flip.setAttribute("aria-pressed", String(controls.direction.value === "reverse"));
    flip.onclick = () => { controls.direction.value = controls.direction.value === "reverse" ? "normal" : "reverse"; paintFlip(); controls.direction.dispatchEvent(new Event("change")); };
    paintFlip(); angle.querySelector(".aui-feature-row-control")?.append(flip);
    const sideLabels = { "One sided": "one", Symmetric: "symmetric", "Two sided": "two" } as const;
    const sidesPicker = win.picker(Object.keys(sideLabels), { ariaLabel: "Parting sides menu", onChange: (text) => { controls.sides.value = sideLabels[text as keyof typeof sideLabels]; sync(); controls.sides.dispatchEvent(new Event("change")); } });
    sidesPicker.setValue(Object.keys(sideLabels).find((key) => sideLabels[key as keyof typeof sideLabels] === controls.sides.value) ?? "One sided");
    const sidesRow = rowIn("Sides", sidesPicker.element); win.body.append(sidesRow);
    const secondAngle = row("Second draft angle", controls.secondAngle, angleUnitLabel);
    // OCCT keeps tangent faces tangent when one is drafted, so propagation is always on.
    const tangent = document.createElement("input"); tangent.type = "checkbox"; tangent.checked = true; tangent.setAttribute("aria-label", "Tangent propagation");
    win.body.append(planned(rowIn("Tangent propagation", tangent), "Always on in this kernel: faces tangent to a drafted face are drafted with it."));
    const reapply = document.createElement("input"); reapply.type = "checkbox"; reapply.setAttribute("aria-label", "Reapply fillets"); win.body.append(planned(rowIn("Reapply fillets", reapply), filletsGap));
    // Saved documents may draft the face in a principal plane about a principal neutral plane.
    if (feature && (!feature.faces || !feature.neutralFace)) {
      const legacy = win.subsection("Planes of this saved draft", { kind: "disclosure", open: true });
      for (const [label, key, unit] of [["Face plane", "facePlane"], ["Face plane offset", "faceOffset", lengthUnitLabel], ["Neutral plane", "neutralPlane"], ["Neutral plane offset", "neutralOffset", lengthUnitLabel]] as [string, string, string?][]) { controls[key].hidden = false; legacy.body.append(unit ? rowIn(label, controls[key], unitSuffix(unit)) : rowIn(label, controls[key])); }
      win.body.append(legacy.element);
    }
    const more = win.subsection("Aether options", { kind: "disclosure", open: false });
    controls.pullMode.hidden = false; more.body.append(rowIn("Pull direction", controls.pullMode));
    const pullRows = ["pullX", "pullY", "pullZ"].map((key, i) => { controls[key].hidden = false; const r = rowIn(["Pull X", "Pull Y", "Pull Z"][i], controls[key]); more.body.append(r); return r; });
    win.body.append(more.element);
    const sync = () => {
      for (const r of pullRows) r.hidden = controls.pullMode.value !== "custom";
      const line = parting();
      neutral.element.hidden = line; entities.element.hidden = line; pullBox.element.hidden = !line; parts.element.hidden = !line;
      sidesRow.hidden = !line; secondAngle.hidden = !line || controls.sides.value !== "two"; more.element.hidden = line;
    };
    controls.pullMode.addEventListener("change", sync); sync();
    // The box that takes picks: the parting edges under Parting line, the entities otherwise.
    (parting() ? parts.element : entities.element).dispatchEvent(new Event("pointerdown"));
  },
  validate(controls) {
    if (!(Number(controls.angle.value) > 0 && Number(controls.angle.value) < 90)) return "Enter a draft angle between 0 and 90 degrees.";
    if (controls.mode.value === "parting-line") {
      if (!controls.pullPlaneRef.value) return "Select the pull direction: a plane in the tree or a planar face.";
      if (!JSON.parse(controls.partingEdges.value || "[]").length) return "Select the parting entities: the edges the faces pivot about.";
      if (controls.sides.value === "two" && !(Number(controls.secondAngle.value) > 0 && Number(controls.secondAngle.value) < 90)) return "Enter a second draft angle between 0 and 90 degrees.";
      return null;
    }
    if (controls.pullMode.value === "custom" && Math.hypot(Number(controls.pullX.value), Number(controls.pullY.value), Number(controls.pullZ.value)) < 1e-9) return "Enter a nonzero pull direction.";
    if (controls.faceScope.value === "picked" && !JSON.parse(controls.faces.value).length) return "Select the entities to draft.";
    if (controls.neutralScope.value === "face" && !JSON.parse(controls.neutralFace.value).length) return "Select the neutral plane.";
    return null;
  },
  serialize(values) {
    if (values.mode === "parting-line") {
      const pull = JSON.parse(values.pullPlaneRef) as MirrorPlaneReference;
      if (pull.kind === "face") delete (pull as { centerMillimeters?: unknown }).centerMillimeters;
      const edges = (JSON.parse(values.partingEdges) as (EdgeFinishEdge & { centerMillimeters?: unknown })[]).map((edge) => { delete edge.centerMillimeters; return edge; });
      return { mode: "parting-line", pullPlane: pull, partingEdges: edges, sides: values.sides, ...(values.sides === "two" ? { secondAngleDegrees: Number(values.secondAngle) } : {}), angleDegrees: Number(values.angle), reversed: values.direction === "reverse" };
    }
    return {
      facePlane: { plane: values.facePlane, offsetMillimeters: Number(values.faceOffset) },
      ...(values.faceScope === "picked" ? { faces: JSON.parse(values.faces) } : {}),
      neutralPlane: { plane: values.neutralPlane, offsetMillimeters: Number(values.neutralOffset) },
      ...(values.neutralScope === "face" ? { neutralFace: JSON.parse(values.neutralFace)[0] } : {}),
      angleDegrees: Number(values.angle), reversed: values.direction === "reverse",
      ...(values.pullMode === "custom" ? { pullDirection: [Number(values.pullX), Number(values.pullY), Number(values.pullZ)] } : {}),
    };
  },
};
