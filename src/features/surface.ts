import { extrudeEditor } from './extrude';
import { mountPartBox } from "./part-box";
import { edgeIdentity } from "./edge-finish";
import { availableBodies, type EdgeFinishEdge, type SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { operationTabs, checkRow, entityChips, iconButton, requireSelections, rowIn, type Control, type Controls, type FeatureEditor, type FeatureEditorContext, unitSuffix } from "./shared";

/** Surface dialogs (SolidCraft's surface.*): sheets from sketch curves, and the
 *  tools that offset, thicken, sew, split and flip them. One editor per feature,
 *  the same fields the engine reads. */

/** A multi-pick of existing bodies, the way Bounding Solid lists parts: a hidden
 *  JSON field holds the ids, an entities box shows them, a select adds one. */
export function bodiesControls({ field, feature, doc }: FeatureEditorContext, key = "bodyIds"): Controls {
  const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
  const choices = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
  const pick = field("Body", choices[0]?.id ?? "", choices.map((b) => b.id));
  Array.from(pick.children).forEach((o, i) => (o.textContent = choices[i].name));
  return { pick, bodies: field("Chosen bodies", JSON.stringify(feature?.[key] ?? [])) };
}
export function bodiesLayout(context: FeatureEditorContext, controls: Controls, caption: string, single = false): void {
  const { form } = context;
  controls.pick.closest("label")?.remove(); controls.pick.hidden = true; controls.pick.setAttribute("form", form.id); form.append(controls.pick);
  mountPartBox(context, controls.bodies, caption, Array.from(controls.pick.children).map((o) => ({ id: (o as HTMLOptionElement).value, name: o.textContent ?? "" })), () => "", { single });
}
export const bodiesValid = (controls: Controls, noun: string, exactly?: number): string | null => {
  const ids: string[] = JSON.parse(controls.bodies.value);
  if (exactly !== undefined ? ids.length !== exactly : !ids.length) return `Choose ${exactly === 1 ? "one" : "at least one"} ${noun}.`;
  return null;
};

// The same dialog, controls and live manipulators; the saved feature keeps its
// native surface identity so earlier surface histories remain editable.
export const surfaceExtrudeEditor: FeatureEditor = {
  ...extrudeEditor, type: 'surface-extrude',
  controls(context) {
    const controls = extrudeEditor.controls(context);
    if (!context.feature) { controls.creationMode.value = 'surface'; controls.operation.value = context.initialOperation ?? 'new'; }
    return controls;
  },
};
export const surfaceRevolveEditor: FeatureEditor = {
  type: "surface-revolve",
  controls({ field, reference, feature }: FeatureEditorContext) {
    return {
      profile: reference("Sketch curves", ["sketch", "profile"], feature?.profileFeatureId),
      axis: field("Axis", feature?.axis ?? "Y", ["X", "Y", "Z"]),
      angle: field("Angle (degrees)", String(feature?.angleDegrees ?? 360)),
      reversed: field("Turn", feature?.reversed ? "reversed" : "normal", ["normal", "reversed"]),
    };
  },
  layout({ win, form }, controls) { entityChips(win, "Sketch curves", controls.profile, form); },
  validate(controls) { const a = Number(controls.angle.value); return !(a > 0 && a <= 360) ? "Angle must be between 0 and 360 degrees." : requireSelections(controls, [{ key: "profile", noun: "a sketch" }]); },
  serialize(values) { return { operation: "new", profileFeatureId: values.profile, axis: values.axis, angleDegrees: Number(values.angle), ...(values.reversed === "reversed" ? { reversed: true } : {}) }; },
};
export const surfaceLoftEditor: FeatureEditor = {
  type: "surface-loft",
  controls({ field, reference, feature }: FeatureEditorContext) {
    return {
      first: reference("First section", ["sketch", "profile"], feature?.sections?.[0]?.profileFeatureId),
      second: reference("Second section", ["sketch", "profile"], feature?.sections?.[1]?.profileFeatureId),
      third: reference("Third section (optional)", ["sketch", "profile"], feature?.sections?.[2]?.profileFeatureId),
      ruled: field("Surface", feature?.ruled ? "ruled" : "smooth", ["smooth", "ruled"]),
    };
  },
  validate(controls) { return controls.first.value && controls.second.value && controls.first.value !== controls.second.value ? null : "Choose two different section sketches."; },
  serialize(values) { return { operation: "new", sections: [values.first, values.second, values.third].filter(Boolean).map((id) => ({ profileFeatureId: id })), ...(values.ruled === "ruled" ? { ruled: true } : {}) }; },
};
export const surfacePatchEditor: FeatureEditor = {
  type: "surface-patch",
  controls({ reference, feature }: FeatureEditorContext) { return { profile: reference("Closed sketch curves", ["sketch", "profile"], feature?.profileFeatureId) }; },
  layout({ win, form }, controls) { entityChips(win, "Closed sketch curves", controls.profile, form); },
  validate(controls) { return requireSelections(controls, [{ key: "profile", noun: "a sketch with a closed curve" }]); },
  serialize(values) { return { operation: "new", profileFeatureId: values.profile }; },
};
export const surfaceSweepEditor: FeatureEditor = {
  type: "surface-sweep",
  controls({ reference, feature }: FeatureEditorContext) {
    return { profile: reference("Profile curves", ["sketch", "profile"], feature?.profileFeatureId), path: reference("Path", ["sketch", "profile"], feature?.pathFeatureId) };
  },
  validate(controls) { return controls.profile.value && controls.path.value && controls.profile.value !== controls.path.value ? null : "Choose a profile sketch and a different path sketch."; },
  serialize(values) { return { operation: "new", profileFeatureId: values.profile, pathFeatureId: values.path }; },
};
export const surfaceOffsetEditor: FeatureEditor = {
  type: "surface-offset",
  controls(context: FeatureEditorContext) { return { ...bodiesControls(context), distance: context.field("Distance (mm)", String(context.feature?.distanceMillimeters ?? 1)) }; },
  layout(context, controls) { bodiesLayout(context, controls, "Surface to offset", true); },
  validate(controls) { return !Number.isFinite(Number(controls.distance.value)) ? "Enter a distance (zero copies the surface)." : bodiesValid(controls, "surface body", 1); },
  serialize(values) { return { operation: "new", bodyIds: JSON.parse(values.bodies), distanceMillimeters: Number(values.distance) }; },
};
const thickenOperations = ["new", "add", "cut"] as const;
/** Thicken, as Onshape's (help: PartStudio/thicken.htm): New / Add / Remove / Intersect, Faces and
 *  surfaces to thicken, Mid plane with its Thickness, else Thickness 1 with the Opposite direction
 *  arrow and Thickness 2 (the other side's own amount), Keep tools and the Merge scope. */
export const surfaceThickenEditor: FeatureEditor = {
  type: "surface-thicken",
  controls(context: FeatureEditorContext) {
    const { field, feature, doc } = context;
    const thickness = feature?.thicknessMillimeters ?? 2;
    return { ...bodiesControls(context), thickness: field("Thickness 1 (mm)", String(Math.abs(thickness))), flipped: field("Opposite direction", String(thickness < 0), ["false", "true"]), symmetric: field("Mid plane", feature?.symmetric ? "true" : "false", ["false", "true"]), operation: field("Operation", feature?.operation ?? "new", [...thickenOperations]),
      second: field("Thickness 2 (mm)", feature?.secondThicknessMillimeters === undefined ? "" : String(feature.secondThicknessMillimeters)),
      // Onshape's default consumes the sheets; a saved record without the flag kept them.
      keepTools: field("Keep tools", feature ? String(feature.keepTools !== false) : "false", ["false", "true"]),
      mergeScope: field("Merge scope part", JSON.stringify(feature?.targetBodyId ? [feature.targetBodyId] : availableBodies(doc).at(-1) ? [availableBodies(doc).at(-1)!.id] : [])) };
  },
  layout(context, controls) {
    const { win, form, lengthUnitLabel, doc, feature } = context;
    operationTabs(win, form, controls.operation, thickenOperations, ["New", "Add", "Remove", "Intersect"]);
    bodiesLayout(context, controls, "Faces and surfaces to thicken");
    const hide = (control: Control) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    hide(controls.flipped); hide(controls.symmetric); hide(controls.mergeScope); hide(controls.second);
    const mid = checkRow(context, controls.symmetric, "Mid plane", () => sync());
    controls.thickness.closest("label")?.remove(); controls.thickness.setAttribute("form", form.id);
    const first = rowIn("Thickness 1", controls.thickness, unitSuffix(lengthUnitLabel)); win.body.append(first);
    const flip = iconButton("flip-horizontal", "Opposite direction");
    const paintFlip = () => flip.setAttribute("aria-pressed", controls.flipped.value);
    flip.onclick = () => { controls.flipped.value = controls.flipped.value === "true" ? "false" : "true"; paintFlip(); controls.flipped.dispatchEvent(new Event("change")); };
    paintFlip(); (first.querySelector(".aui-feature-row-control") ?? first).append(flip);
    (controls.second as HTMLInputElement).placeholder = "none";
    const secondRow = rowIn("Thickness 2", controls.second, unitSuffix(lengthUnitLabel)); win.body.append(secondRow);
    checkRow(context, controls.keepTools, "Keep tools");
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const scope = mountPartBox(context, controls.mergeScope, "Merge scope", availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined }), () => "", { single: true });
    win.body.append(scope.element);
    controls.mergeScope.addEventListener("change", () => { const id = JSON.parse(controls.mergeScope.value || "[]")[0]; if (id) { controls.target.value = id; controls.target.dispatchEvent(new Event("change")); } });
    const sync = () => { const both = controls.symmetric.value === "true"; first.querySelector("span")!.textContent = both ? "Thickness" : "Thickness 1"; flip.hidden = both; secondRow.hidden = both; scope.element.hidden = controls.operation.value === "new"; };
    controls.operation.addEventListener("change", sync); void mid; sync();
  },
  validate(controls) {
    if (!(Number(controls.thickness.value) > 0)) return "Enter a positive thickness.";
    if (controls.symmetric.value !== "true" && controls.second.value.trim() && !(Number(controls.second.value) > 0)) return "Thickness 2 must be positive, or blank.";
    if (controls.operation.value !== "new" && !JSON.parse(controls.mergeScope.value || "[]").length) return "Select the merge scope part.";
    return bodiesValid(controls, "surface body");
  },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), thicknessMillimeters: Number(values.thickness) * (values.flipped === "true" ? -1 : 1), ...(values.symmetric === "true" ? { symmetric: true } : values.second.trim() ? { secondThicknessMillimeters: Number(values.second) } : {}), keepTools: values.keepTools === "true", operation: values.operation, ...(values.operation !== "new" ? { targetBodyId: JSON.parse(values.mergeScope || "[]")[0] } : {}) }; },
};
export const surfaceStitchEditor: FeatureEditor = {
  type: "surface-stitch",
  controls(context: FeatureEditorContext) { return { ...bodiesControls(context), tolerance: context.field("Tolerance (mm)", String(context.feature?.toleranceMillimeters ?? 0.001)) }; },
  layout(context, controls) { bodiesLayout(context, controls, "Surfaces to sew (into the first)"); },
  validate(controls) { if (!(Number(controls.tolerance.value) > 0)) return "Tolerance must be positive."; const ids: string[] = JSON.parse(controls.bodies.value); return ids.length < 2 ? "Choose two or more surface bodies." : null; },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), toleranceMillimeters: Number(values.tolerance) }; },
};
export const surfaceUnstitchEditor: FeatureEditor = {
  type: "surface-unstitch",
  controls(context: FeatureEditorContext) { return bodiesControls(context); },
  layout(context, controls) { bodiesLayout(context, controls, "Surface to take apart", true); },
  validate(controls) { return bodiesValid(controls, "surface body", 1); },
  serialize(values) { return { operation: "new", bodyIds: JSON.parse(values.bodies) }; },
};
export const surfaceReverseNormalEditor: FeatureEditor = {
  type: "surface-reverse-normal",
  controls(context: FeatureEditorContext) { return bodiesControls(context); },
  layout(context, controls) { bodiesLayout(context, controls, "Surface to turn over", true); },
  validate(controls) { return bodiesValid(controls, "surface body", 1); },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies) }; },
};
const edgesValid = (controls: Controls): string | null => (JSON.parse(controls.edges.value || "[]") as unknown[]).length ? null : "Pick the edges in the viewport.";
export const surfaceRuledEditor: FeatureEditor = {
  type: "surface-ruled",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    return { ...bodiesControls(context), edges: field("Picked edges", JSON.stringify(feature?.edges ?? [])), distance: field("Distance (mm)", String(feature?.distanceMillimeters ?? 5)), mode: field("Reach", feature?.mode ?? "normal", ["normal", "tangent", "direction"]), direction: field("Direction (x,y,z)", (feature?.direction ?? [0, 0, 1]).join(",")) };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Body with the edges", true);
    mountPickedReferences<EdgeFinishEdge>(context, controls.edges, { title: "Edges to rule from", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity, note: "Pick edges of the chosen body in the viewport; the strip reaches the distance from each." });
    const row = controls.direction.closest<HTMLElement>(".aui-feature-row") ?? controls.direction.parentElement;
    const sync = () => { if (row) row.hidden = controls.mode.value !== "direction"; };
    controls.mode.addEventListener("change", sync); sync();
  },
  validate(controls) {
    if (!(Number(controls.distance.value) > 0)) return "Enter a positive distance.";
    if (controls.mode.value === "direction" && controls.direction.value.split(",").map(Number).some((v) => !Number.isFinite(v))) return "Enter a direction as x,y,z.";
    return bodiesValid(controls, "body", 1) ?? edgesValid(controls);
  },
  serialize(values) { return { operation: "new", bodyIds: JSON.parse(values.bodies), edges: JSON.parse(values.edges), distanceMillimeters: Number(values.distance), mode: values.mode, ...(values.mode === "direction" ? { direction: values.direction.split(",").map(Number) } : {}) }; },
};
export const surfaceExtendEditor: FeatureEditor = {
  type: "surface-extend",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    return { ...bodiesControls(context), edges: field("Picked edges", JSON.stringify(feature?.edges ?? [])), distance: field("Distance (mm)", String(feature?.distanceMillimeters ?? 5)) };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Surface to extend", true);
    mountPickedReferences<EdgeFinishEdge>(context, controls.edges, { title: "Boundary edges to push out", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity, note: "The surface continues past each picked edge by the distance." });
  },
  validate(controls) { return !(Number(controls.distance.value) > 0) ? "Enter a positive distance." : bodiesValid(controls, "surface body", 1) ?? edgesValid(controls); },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), edges: JSON.parse(values.edges), distanceMillimeters: Number(values.distance) }; },
};
export const surfaceBoundaryEditor: FeatureEditor = {
  type: "surface-boundary",
  controls(context: FeatureEditorContext) { return { ...bodiesControls(context), edges: context.field("Picked edges", JSON.stringify(context.feature?.edges ?? [])) }; },
  layout(context, controls) {
    bodiesLayout(context, controls, "Body with the edges", true);
    mountPickedReferences<EdgeFinishEdge>(context, controls.edges, { title: "Edges of the loop (2 to 4)", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity, note: "Pick edges that meet end to end around the opening to fill." });
  },
  validate(controls) { const n = (JSON.parse(controls.edges.value || "[]") as unknown[]).length; return bodiesValid(controls, "body", 1) ?? (n < 2 || n > 4 ? "Pick two to four edges." : null); },
  serialize(values) { return { operation: "new", bodyIds: JSON.parse(values.bodies), edges: JSON.parse(values.edges) }; },
};
export const surfaceBlendEditor: FeatureEditor = {
  type: "surface-blend",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    const bodies = bodiesControls(context);
    return { pick: bodies.pick, bodies: bodies.bodies, fromEdges: field("From edges", JSON.stringify(feature?.from?.edges ?? [])), toEdges: field("To edges", JSON.stringify(feature?.to?.edges ?? [])) };
  },
  layout(context, controls) {
    controls.bodies.closest("label")?.remove(); controls.bodies.hidden = true; controls.pick.closest("label")?.remove(); controls.pick.hidden = true;
    mountPickedReferences<EdgeFinishEdge>(context, controls.toEdges, { title: "To edges", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity, note: "The chain the blend ends on." });
    mountPickedReferences<EdgeFinishEdge>(context, controls.fromEdges, { title: "From edges", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity, note: "The chain the blend starts from; each chain's body is read from its picks." });
  },
  validate(controls) {
    const from = JSON.parse(controls.fromEdges.value || "[]") as EdgeFinishEdge[], to = JSON.parse(controls.toEdges.value || "[]") as EdgeFinishEdge[];
    if (!from.length || !to.length) return "Pick edges for both chains.";
    if (new Set(from.map((e) => e.bodyId)).size !== 1 || new Set(to.map((e) => e.bodyId)).size !== 1) return "Each chain's edges must be on one body.";
    return null;
  },
  serialize(values) {
    const from = JSON.parse(values.fromEdges) as EdgeFinishEdge[], to = JSON.parse(values.toEdges) as EdgeFinishEdge[];
    return { operation: "new", from: { bodyId: from[0].bodyId, edges: from }, to: { bodyId: to[0].bodyId, edges: to } };
  },
};
export const surfaceUntrimEditor: FeatureEditor = {
  type: "surface-untrim",
  controls(context: FeatureEditorContext) { return { ...bodiesControls(context), face: context.field("Face", JSON.stringify(context.feature?.face ? [context.feature.face] : [])) }; },
  layout(context, controls) {
    bodiesLayout(context, controls, "Surface body", true);
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, { title: "Face to untrim", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity, note: "The face is rebuilt from its outer boundary; its holes close.", onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); } });
  },
  validate(controls) { return bodiesValid(controls, "surface body", 1) ?? ((JSON.parse(controls.face.value || "[]") as unknown[]).length === 1 ? null : "Pick the face to untrim."); },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), face: JSON.parse(values.face)[0] }; },
};
export const surfaceEditors: FeatureEditor[] = [surfaceBoundaryEditor, surfaceBlendEditor, surfaceUntrimEditor, surfaceRuledEditor, surfaceExtendEditor, surfaceExtrudeEditor, surfaceRevolveEditor, surfaceLoftEditor, surfacePatchEditor, surfaceSweepEditor, surfaceOffsetEditor, surfaceThickenEditor, surfaceStitchEditor, surfaceUnstitchEditor, surfaceReverseNormalEditor];
