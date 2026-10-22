import { defaultSheetMetalRule, type EdgeFinishEdge } from "@aether/core/document";
import { mountPickedReferences } from "./picked-references";
import { entityChips, requireSelections, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";
import { bodiesControls, bodiesLayout, bodiesValid } from "./surface";

/** Sheet metal dialogs (SolidCraft's sheet.*): the base plate carries the rule;
 *  flanges and hems bend from picked edges; Unfold and Refold swap the body
 *  between folded and flat. */
const edgeIdentity = (edge: EdgeFinishEdge) => JSON.stringify(edge.kind === "solid-edge" ? [edge.bodyId, edge.anchor.start.signature, edge.anchor.end.signature] : [edge.bodyId, edge.midpointMillimeters, edge.lengthMillimeters]);
const edgesValid = (controls: Controls): string | null => (JSON.parse(controls.edges.value || "[]") as unknown[]).length ? null : "Pick the edges in the viewport.";
const bodyOnly = (type: "sheet-unfold" | "sheet-refold", caption: string): FeatureEditor => ({
  type,
  controls(context: FeatureEditorContext) { return bodiesControls(context); },
  layout(context, controls) { bodiesLayout(context, controls, caption, true); },
  validate(controls) { return bodiesValid(controls, "sheet metal body", 1); },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies) }; },
});

export const sheetBaseEditor: FeatureEditor = {
  type: "sheet-base",
  controls({ field, reference, feature }: FeatureEditorContext) {
    return {
      profile: reference("Sketch", ["sketch", "profile"], feature?.profileFeatureId),
      thickness: field("Thickness (mm)", String(feature?.thicknessMillimeters ?? defaultSheetMetalRule.thicknessMillimeters)),
      radius: field("Bend radius (mm)", String(feature?.bendRadiusMillimeters ?? defaultSheetMetalRule.bendRadiusMillimeters)),
      kFactor: field("K factor", String(feature?.kFactor ?? defaultSheetMetalRule.kFactor)),
      side: field("Build", feature?.reversed ? "behind" : "in front", ["in front", "behind"]),
    };
  },
  layout({ win, form }, controls) { entityChips(win, "Sketch region", controls.profile, form); },
  validate(controls) {
    if (!(Number(controls.thickness.value) > 0)) return "Enter a positive thickness.";
    if (!(Number(controls.radius.value) > 0)) return "Enter a positive bend radius.";
    const k = Number(controls.kFactor.value); if (!(k > 0 && k <= 1)) return "K factor must be between 0 and 1.";
    return requireSelections(controls, [{ key: "profile", noun: "a sketch" }]);
  },
  serialize(values) { return { operation: "new", profileFeatureId: values.profile, thicknessMillimeters: Number(values.thickness), bendRadiusMillimeters: Number(values.radius), kFactor: Number(values.kFactor), ...(values.side === "behind" ? { reversed: true } : {}) }; },
};
export const sheetFlangeEditor: FeatureEditor = {
  type: "sheet-flange",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    return { ...bodiesControls(context), edges: field("Picked edges", JSON.stringify(feature?.edges ?? [])), distance: field("Length (mm)", String(feature?.distanceMillimeters ?? 10)), angle: field("Angle (degrees)", String(feature?.angleDegrees ?? 90)), direction: field("Fold", feature?.inward ? "toward the face" : "away from the face", ["away from the face", "toward the face"]), radius: field("Bend radius (mm, blank = rule)", feature?.bendRadiusMillimeters === undefined ? "" : String(feature.bendRadiusMillimeters)) };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Sheet metal body", true);
    mountPickedReferences<EdgeFinishEdge>(context, controls.edges, { title: "Edges to bend from", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity, note: "Pick edges on a flat face of the sheet; the flange folds away from that face unless told otherwise." });
  },
  validate(controls) {
    if (!(Number(controls.distance.value) > 0)) return "Enter a positive length.";
    const a = Number(controls.angle.value); if (!(a > 0 && a <= 180)) return "Angle must be between 0 and 180 degrees.";
    if (controls.radius.value.trim() && !(Number(controls.radius.value) > 0)) return "Bend radius must be positive.";
    return bodiesValid(controls, "sheet metal body", 1) ?? edgesValid(controls);
  },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), edges: JSON.parse(values.edges), distanceMillimeters: Number(values.distance), angleDegrees: Number(values.angle), ...(values.direction === "toward the face" ? { inward: true } : {}), ...(values.radius?.trim() ? { bendRadiusMillimeters: Number(values.radius) } : {}) }; },
};
export const sheetHemEditor: FeatureEditor = {
  type: "sheet-hem",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    return { ...bodiesControls(context), edges: field("Picked edges", JSON.stringify(feature?.edges ?? [])), length: field("Length (mm)", String(feature?.lengthMillimeters ?? 8)), gap: field("Gap (mm, blank = rule)", feature?.gapMillimeters === undefined ? "" : String(feature.gapMillimeters)), direction: field("Fold", feature?.inward ? "toward the face" : "away from the face", ["away from the face", "toward the face"]) };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Sheet metal body", true);
    mountPickedReferences<EdgeFinishEdge>(context, controls.edges, { title: "Edges to hem", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity, note: "The edge folds back 180° under (or over) the sheet, leaving the gap as its inner radius." });
  },
  validate(controls) {
    if (!(Number(controls.length.value) > 0)) return "Enter a positive length.";
    if (controls.gap.value.trim() && !(Number(controls.gap.value) > 0)) return "Gap must be positive.";
    return bodiesValid(controls, "sheet metal body", 1) ?? edgesValid(controls);
  },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies), edges: JSON.parse(values.edges), lengthMillimeters: Number(values.length), ...(values.gap?.trim() ? { gapMillimeters: Number(values.gap) } : {}), ...(values.direction === "toward the face" ? { inward: true } : {}) }; },
};
export const sheetUnfoldEditor = bodyOnly("sheet-unfold", "Sheet metal body to unfold");
export const sheetRefoldEditor = bodyOnly("sheet-refold", "Unfolded body to refold");
export const sheetMetalEditors: FeatureEditor[] = [sheetBaseEditor, sheetFlangeEditor, sheetHemEditor, sheetUnfoldEditor, sheetRefoldEditor];
