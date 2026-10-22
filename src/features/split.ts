import type { SolidFaceReference } from "@aether/core/document";
import { availableBodies } from "@aether/core/document";
import { sketchDirectionLines } from "../modeling/extrude-direction-reference";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { requireSelections, type FeatureEditor } from "./shared";

/** Split Body: one part, a plane (principal + offset, a plane feature, or a
 *  picked planar face), and which side to keep. Keeping both makes a second
 *  part with a new identity. */
export const splitEditor: FeatureEditor = {
  type: "split",
  controls(context) {
    const { field, reference, feature, doc } = context;
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const choices = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const plane = feature?.plane;
    const body = field("Part to split", feature?.bodyIds?.[0] ?? choices.at(-1)?.id ?? "", choices.map((b) => b.id));
    Array.from(body.children).forEach((o, i) => (o.textContent = choices[i].name));
    return {
      body,
      planeSource: field("Plane source", plane?.kind ?? "principal", ["principal", "feature", "face", "sketch-line"]),
      sketchLine: (() => {
        const lines = sketchDirectionLines(doc, feature?.id), key = (l: typeof lines[number]) => JSON.stringify({ sourceFeatureId: l.sourceFeatureId, contourId: l.contourId, segmentId: l.segmentId });
        const saved = plane?.kind === "sketch-line" ? JSON.stringify({ sourceFeatureId: plane.sourceFeatureId, contourId: plane.contourId, segmentId: plane.segmentId }) : "";
        const control = field("Sketch line", saved, ["", ...lines.map(key), ...(saved && !lines.some((l) => key(l) === saved) ? [saved] : [])]);
        for (const option of (control as HTMLSelectElement).options) option.textContent = lines.find((l) => key(l) === option.value)?.label ?? (option.value ? "Unavailable sketch line" : "Choose a straight sketch line");
        return control;
      })(),
      plane: field("Plane", plane?.kind === "principal" ? plane.plane : "XY", ["XY", "XZ", "YZ"]),
      offset: field("Plane offset (mm)", String(plane?.kind === "principal" ? plane.offsetMillimeters : 0)),
      planeFeature: reference("Plane feature", ["plane"], plane?.kind === "feature" ? plane.featureId : undefined),
      face: field("Split face", JSON.stringify(plane?.kind === "face" ? [plane] : [])),
      keep: field("Keep", feature?.keep ?? "both", ["both", "positive", "negative"]),
      copy: field("Second piece ID", feature?.copyBodyIds?.[feature.bodyIds[0]] ?? `${doc.documentId}:split-${crypto.randomUUID()}`),
    };
  },
  layout(context, controls) {
    const { form } = context;
    for (const key of ["copy"]) { controls[key].closest("label")?.remove(); controls[key].hidden = true; controls[key].setAttribute("form", form.id); form.append(controls[key]); }
    const row = (key: string) => controls[key].closest<HTMLElement>(".aui-feature-row") ?? controls[key].parentElement;
    const sync = () => { const s = controls.planeSource.value; for (const [key, when] of [["plane", "principal"], ["offset", "principal"], ["planeFeature", "feature"], ["sketchLine", "sketch-line"]] as const) { const el = row(key); if (el) el.hidden = s !== when; } };
    controls.planeSource.addEventListener("change", sync); sync();
    for (const option of controls.keep.children) option.textContent = ({ both: "Both pieces", positive: "The side the plane faces", negative: "The side behind the plane" } as Record<string, string>)[(option as HTMLOptionElement).value];
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, {
      title: "Split face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Optional: a planar face whose plane splits the part.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); else { controls.planeSource.value = picked.length ? "face" : "principal"; controls.planeSource.dispatchEvent(new Event("change")); } },
    });
  },
  validate(controls) {
    if (controls.planeSource.value === "feature" && !controls.planeFeature.value) return "Choose the plane feature to split with.";
    if (controls.planeSource.value === "face" && !JSON.parse(controls.face.value).length) return "Pick the planar face to split with.";
    if (controls.planeSource.value === "sketch-line" && !controls.sketchLine.value) return "Choose the sketch line to split along.";
    if (controls.planeSource.value === "principal" && !Number.isFinite(Number(controls.offset.value))) return "Enter a finite plane offset.";
    return requireSelections(controls, [{ key: "body", noun: "a part to split" }]);
  },
  serialize(values) {
    const plane = values.planeSource === "sketch-line" ? { kind: "sketch-line", ...JSON.parse(values.sketchLine) }
      : values.planeSource === "feature" ? { kind: "feature", featureId: values.planeFeature }
      : values.planeSource === "face" ? { kind: "face", ...(() => { const f = JSON.parse(values.face)[0]; delete f.centerMillimeters; return f; })() }
      : { kind: "principal", plane: values.plane, offsetMillimeters: Number(values.offset) };
    return { bodyIds: [values.body], plane, keep: values.keep, ...(values.keep === "both" ? { copyBodyIds: { [values.body]: values.copy } } : {}) };
  },
};
