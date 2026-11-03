import { edgeIdentity } from "./edge-finish";
import { defaultSheetMetalRule, type EdgeFinishEdge } from "@aether/core/document";
import type { SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { sketchDirectionLines } from "../modeling/extrude-direction-reference";
import { entityChips, requireSelections, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";
import { bodiesControls, bodiesLayout, bodiesValid } from "./surface";

/** Sheet metal dialogs (SolidCraft's sheet.*): the base plate carries the rule;
 *  flanges and hems bend from picked edges; Unfold and Refold swap the body
 *  between folded and flat. */
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
export const sheetFoldEditor: FeatureEditor = {
  type: "sheet-fold",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    // The fold line is a straight sketch line, offered the way Extrude offers direction lines.
    const lines = sketchDirectionLines(context.doc, feature?.id);
    const key = (line: (typeof lines)[number]) => JSON.stringify([line.sourceFeatureId, line.contourId, line.segmentId]);
    const ref = feature?.line;
    const selected = lines.find((line) => ref && line.sourceFeatureId === ref.sourceFeatureId && line.contourId === ref.contourId && line.segmentId === ref.segmentId);
    const lineField = field("Fold line", selected ? key(selected) : "", ["", ...lines.map(key)]);
    for (const option of (lineField as HTMLSelectElement).options) option.textContent = lines.find((line) => key(line) === option.value)?.label ?? "Choose a sketch line on the sheet";
    return { ...bodiesControls(context), line: lineField, angle: field("Angle (degrees)", String(feature?.angleDegrees ?? 90)), direction: field("Fold", feature?.inward ? "toward the face" : "away from the face", ["away from the face", "toward the face"]), side: field("Moving side", feature?.otherSide ? "right of the line" : "left of the line", ["left of the line", "right of the line"]), radius: field("Bend radius (mm, blank = rule)", feature?.bendRadiusMillimeters === undefined ? "" : String(feature.bendRadiusMillimeters)) };
  },
  layout(context, controls) { bodiesLayout(context, controls, "Sheet metal body", true); },
  validate(controls) {
    if (!controls.line.value) return "Choose the sketch line to fold along.";
    const a = Number(controls.angle.value); if (!(a > 0 && a <= 180)) return "Angle must be between 0 and 180 degrees.";
    if (controls.radius.value.trim() && !(Number(controls.radius.value) > 0)) return "Bend radius must be positive.";
    return bodiesValid(controls, "sheet metal body", 1);
  },
  serialize(values) {
    const [sourceFeatureId, contourId, segmentId] = JSON.parse(values.line) as [string, string, string];
    return { bodyIds: JSON.parse(values.bodies), line: { kind: "sketch-line", sourceFeatureId, contourId, segmentId }, angleDegrees: Number(values.angle), ...(values.direction === "toward the face" ? { inward: true } : {}), ...(values.side === "right of the line" ? { otherSide: true } : {}), ...(values.radius?.trim() ? { bendRadiusMillimeters: Number(values.radius) } : {}) };
  },
};
export const sheetUnfoldEditor = bodyOnly("sheet-unfold", "Sheet metal body to unfold");
export const sheetRefoldEditor = bodyOnly("sheet-refold", "Unfolded body to refold");
/** Perforate: a grid of round holes through a picked planar face, clear of edges and cut-outs. */
export const sheetPerforateEditor: FeatureEditor = {
  type: "sheet-perforate",
  controls(context: FeatureEditorContext) {
    const { field, feature } = context;
    return { ...bodiesControls(context), face: field("Face", JSON.stringify(feature?.face ? [feature.face] : [])),
      diameter: field("Hole diameter (mm)", String(feature?.diameterMillimeters ?? 4)), pitch: field("Pitch (mm)", String(feature?.pitchMillimeters ?? 8)),
      margin: field("Margin (mm, blank = diameter)", feature?.marginMillimeters === undefined ? "" : String(feature.marginMillimeters)),
      pattern: field("Pattern", feature?.pattern ?? "staggered", ["staggered", "square"]) };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Sheet metal body", true);
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, { title: "Face to perforate", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick a planar face of the sheet. Holes keep the margin from its edges and cut-outs; staggered rows sit at 60°.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); } });
  },
  validate(controls) {
    const face = JSON.parse(controls.face.value || "[]")[0] as SolidFaceReference | undefined;
    if (!face) return "Pick the face to perforate.";
    if (face.surfaceType) return "The face must be planar.";
    const d = Number(controls.diameter.value), p = Number(controls.pitch.value);
    if (!(d > 0)) return "Enter a positive hole diameter.";
    if (!(p > d)) return "The pitch must be larger than the hole diameter.";
    if (controls.margin.value.trim() && !(Number(controls.margin.value) >= 0)) return "The margin must be zero or more.";
    return bodiesValid(controls, "sheet metal body", 1);
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    return { bodyIds: JSON.parse(values.bodies), face, diameterMillimeters: Number(values.diameter), pitchMillimeters: Number(values.pitch), ...(values.margin?.trim() ? { marginMillimeters: Number(values.margin) } : {}), pattern: values.pattern };
  },
};
export const sheetMetalEditors: FeatureEditor[] = [sheetBaseEditor, sheetFlangeEditor, sheetHemEditor, sheetFoldEditor, sheetUnfoldEditor, sheetRefoldEditor, sheetPerforateEditor];
