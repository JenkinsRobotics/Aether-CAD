import { HOLE_THREAD_STANDARDS, HOLE_THREAD_STANDARD_LABELS, threadClasses, threadDesignations, threadSpecification, type HoleThreadStandard, type SolidFaceReference } from "@aether/core/document";
const FREE = "ISO metric (typed)";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Cosmetic thread: a designation on a cylindrical face, typed ISO metric or from a Hole thread table, with an optional class. */
export const threadEditor: FeatureEditor = {
  type: "thread",
  controls({ field, feature }: FeatureEditorContext) {
    return {
      face: field("Thread face", JSON.stringify(feature?.face ? [feature.face] : [])),
      standard: field("Standard", feature?.standard ? HOLE_THREAD_STANDARD_LABELS[feature.standard as HoleThreadStandard] : FREE, [FREE, ...HOLE_THREAD_STANDARDS.map((s) => HOLE_THREAD_STANDARD_LABELS[s])]),
      designation: field("Designation", feature?.designation ?? "M8"),
      threadClass: field("Class (blank = default)", feature?.threadClass ?? ""),
      length: field("Length (mm, blank = whole face)", feature?.lengthMillimeters === undefined ? "" : String(feature.lengthMillimeters)),
    };
  },
  layout(context, controls) {
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, {
      title: "Cylindrical face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick one cylindrical face. The thread is cosmetic: the model is unchanged and the tree lists it.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); },
    });
  },
  validate(controls) {
    const face = JSON.parse(controls.face.value)[0] as SolidFaceReference | undefined;
    if (!face) return "Pick the cylindrical face.";
    if (face.surfaceType !== "cylinder") return "The thread face must be cylindrical.";
    const standard = standardFor(controls.standard.value);
    if (standard && !threadSpecification(standard, controls.designation.value)) return `Use a ${HOLE_THREAD_STANDARD_LABELS[standard]} size such as ${threadDesignations(standard)[4] ?? threadDesignations(standard)[0]}.`;
    if (!standard && !/^M\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?$/i.test(controls.designation.value.trim())) return "Use an ISO metric designation such as M8 or M8x1.";
    if (controls.threadClass.value.trim() && !threadClasses(standard ?? "iso-metric-coarse").includes(controls.threadClass.value.trim())) return `Class must be one of ${threadClasses(standard ?? "iso-metric-coarse").join(", ") || "none for a pipe thread"}.`;
    if (controls.length.value.trim() && !(Number(controls.length.value) > 0)) return "Length must be positive.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    const standard = standardFor(values.standard);
    return { face, designation: values.designation.trim(), ...(standard ? { standard } : {}), ...(values.threadClass?.trim() ? { threadClass: values.threadClass.trim() } : {}), ...(values.length?.trim() ? { lengthMillimeters: Number(values.length) } : {}) };
  },
};
const standardFor = (label: string): HoleThreadStandard | undefined => HOLE_THREAD_STANDARDS.find((s) => HOLE_THREAD_STANDARD_LABELS[s] === label);
