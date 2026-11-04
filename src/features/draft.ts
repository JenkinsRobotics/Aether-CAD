/** Draft, as Onshape's (help: draft.htm): the Neutral plane / Parting line tabs; Neutral plane,
 *  Entities to draft, Draft angle with its flip, Tangent propagation and Reapply fillets. This
 *  kernel drafts picked planar faces about a neutral planar face (or a principal plane for saved
 *  documents): the Parting line mode, Tangent propagation and Reapply fillets are present and
 *  disabled with the gap named (ledger: Draft). A custom pull direction sits under Aether options. */
import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { iconButton, planned, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const partingGap = "Not available in this kernel: a draft about a parting line (pull direction, parting edges, one or two sided) is a recorded gap.";
const tangentGap = "Not available in this kernel: propagating the draft to tangent faces is a recorded gap.";
const filletsGap = "Not available in this kernel: reapplying fillets as cones after the draft is a recorded gap.";

export const draftEditor: FeatureEditor = {
  type: "draft",
  controls({ field, feature }: FeatureEditorContext): Controls {
    return {
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
    const tabs = win.tabs(["Neutral plane", "Parting line"], 0);
    planned(tabs.children[1] as HTMLButtonElement, partingGap);
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
    // Boxes mount by prepending: put them in Onshape's order after the tabs.
    win.body.insertBefore(neutral.element, tabs.nextSibling); win.body.insertBefore(entities.element, neutral.element.nextSibling);
    const angle = row("Draft angle", controls.angle, angleUnitLabel);
    const flip = iconButton("flip-horizontal", "Opposite direction");
    const paintFlip = () => flip.setAttribute("aria-pressed", String(controls.direction.value === "reverse"));
    flip.onclick = () => { controls.direction.value = controls.direction.value === "reverse" ? "normal" : "reverse"; paintFlip(); controls.direction.dispatchEvent(new Event("change")); };
    paintFlip(); angle.querySelector(".aui-feature-row-control")?.append(flip);
    const check = (label: string, reason: string) => { const box = document.createElement("input"); box.type = "checkbox"; box.setAttribute("aria-label", label); win.body.append(planned(rowIn(label, box), reason)); };
    check("Tangent propagation", tangentGap); check("Reapply fillets", filletsGap);
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
    const sync = () => { for (const r of pullRows) r.hidden = controls.pullMode.value !== "custom"; };
    controls.pullMode.addEventListener("change", sync); sync();
  },
  validate(controls) {
    if (controls.pullMode.value === "custom" && Math.hypot(Number(controls.pullX.value), Number(controls.pullY.value), Number(controls.pullZ.value)) < 1e-9) return "Enter a nonzero pull direction.";
    if (controls.faceScope.value === "picked" && !JSON.parse(controls.faces.value).length) return "Select the entities to draft.";
    if (controls.neutralScope.value === "face" && !JSON.parse(controls.neutralFace.value).length) return "Select the neutral plane.";
    if (!(Number(controls.angle.value) > 0 && Number(controls.angle.value) < 90)) return "Enter a draft angle between 0 and 90 degrees.";
    return null;
  },
  serialize(values) {
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
