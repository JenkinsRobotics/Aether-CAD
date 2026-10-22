import { availableBodies, type EdgeFinishEdge, type SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { bodyAndOperationTabs, entityChips, requireSelections, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

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
export function bodiesLayout({ win, form }: FeatureEditorContext, controls: Controls, caption: string, single = false): void {
  controls.bodies.closest("label")?.remove(); controls.bodies.hidden = true; controls.bodies.setAttribute("form", form.id); form.append(controls.bodies);
  const box = win.entitiesBox(caption); win.body.prepend(box.element);
  const names = new Map(Array.from(controls.pick.children).map((o) => [(o as HTMLOptionElement).value, o.textContent ?? ""]));
  const read = (): string[] => JSON.parse(controls.bodies.value);
  const update = (ids: string[]) => { controls.bodies.value = JSON.stringify(ids); render(); controls.bodies.dispatchEvent(new Event("change")); };
  const render = () => box.render(read().map((id) => ({ label: names.get(id) ?? id, onRemove: () => update(read().filter((other) => other !== id)) })));
  const add = document.createElement("button"); add.type = "button"; add.className = "aui-button"; add.textContent = single ? "Use body" : "Add body";
  add.onclick = () => { const id = controls.pick.value; if (!id) return; update(single ? [id] : read().includes(id) ? read() : [...read(), id]); };
  // The window re-renders its parameter rows after layout, so the button lives in the entities box, as Bounding Solid does.
  box.element.append(add);
  render();
}
export const bodiesValid = (controls: Controls, noun: string, exactly?: number): string | null => {
  const ids: string[] = JSON.parse(controls.bodies.value);
  if (exactly !== undefined ? ids.length !== exactly : !ids.length) return `Choose ${exactly === 1 ? "one" : "at least one"} ${noun}.`;
  return null;
};

export const surfaceExtrudeEditor: FeatureEditor = {
  type: "surface-extrude",
  controls({ field, reference, feature }: FeatureEditorContext) {
    return {
      profile: reference("Sketch curves", ["sketch", "profile"], feature?.profileFeatureId),
      distance: field("Distance (mm)", String(feature?.distanceMillimeters ?? 10)),
      direction: field("Direction", feature?.symmetric ? "symmetric" : feature?.reversed ? "reversed" : "normal", ["normal", "reversed", "symmetric"]),
    };
  },
  layout({ win, form }, controls) { entityChips(win, "Sketch curves", controls.profile, form); },
  validate(controls) { return !(Number(controls.distance.value) > 0) ? "Enter a positive distance." : requireSelections(controls, [{ key: "profile", noun: "a sketch" }]); },
  serialize(values) { return { operation: "new", profileFeatureId: values.profile, distanceMillimeters: Number(values.distance), ...(values.direction === "reversed" ? { reversed: true } : {}), ...(values.direction === "symmetric" ? { symmetric: true } : {}) }; },
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
export const surfaceThickenEditor: FeatureEditor = {
  type: "surface-thicken",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    return { ...bodiesControls(context), thickness: field("Thickness (mm)", String(feature?.thicknessMillimeters ?? 2)), symmetric: field("Sides", feature?.symmetric ? "both" : "one", ["one", "both"]), operation: field("Operation", feature?.operation ?? "new", [...thickenOperations]) };
  },
  layout(context, controls) { bodyAndOperationTabs(context.win, context.form, controls.operation, thickenOperations); bodiesLayout(context, controls, "Surfaces to thicken"); },
  validate(controls) { return !(Number(controls.thickness.value) !== 0 && Number.isFinite(Number(controls.thickness.value))) ? "Enter a nonzero thickness." : bodiesValid(controls, "surface body"); },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), thicknessMillimeters: Number(values.thickness), ...(values.symmetric === "both" ? { symmetric: true } : {}), operation: values.operation }; },
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
const edgeIdentity = (edge: EdgeFinishEdge) => JSON.stringify(edge.kind === "solid-edge" ? [edge.bodyId, edge.anchor.start.signature, edge.anchor.end.signature] : [edge.bodyId, edge.midpointMillimeters, edge.lengthMillimeters]);
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
