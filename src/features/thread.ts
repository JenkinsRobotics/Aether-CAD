/** External thread, as Onshape's (help: PartStudio/external_thread.htm): the cylinder, Standard,
 *  Size, Threads per inch or Pitch, End type (Blind with Length, or Up to next), Add chamfer, Add
 *  undercut and Split face. The thread is cosmetic here as in Onshape. This kernel takes the
 *  cylindrical face (Onshape takes its circular edges) and has no chamfer, undercut or face split
 *  for the thread yet: those are present and disabled with the gap named (ledger: External thread). */
import { HOLE_THREAD_STANDARDS, HOLE_THREAD_STANDARD_LABELS, threadClasses, threadDesignations, threadSpecification, type HoleThreadStandard, type SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { planned, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const FREE = "ISO metric (typed)";
const standardFor = (label: string): HoleThreadStandard | undefined => HOLE_THREAD_STANDARDS.find((s) => HOLE_THREAD_STANDARD_LABELS[s] === label);
const chamferGap = "Not available in this kernel: a chamfer at the thread's start is a recorded gap (use Chamfer on the edge).";
const undercutGap = "Not available in this kernel: an undercut at the thread's end is a recorded gap.";
const splitGap = "Not available in this kernel: splitting the face at the thread's end is a recorded gap.";

export const threadEditor: FeatureEditor = {
  type: "thread",
  controls({ field, feature }: FeatureEditorContext): Controls {
    return {
      face: field("Thread face", JSON.stringify(feature?.face ? [feature.face] : [])),
      standard: field("Standard", feature?.standard ? HOLE_THREAD_STANDARD_LABELS[feature.standard as HoleThreadStandard] : FREE, [FREE, ...HOLE_THREAD_STANDARDS.map((s) => HOLE_THREAD_STANDARD_LABELS[s])]),
      designation: field("Size", feature?.designation ?? "M8"),
      threadClass: field("Thread class", feature?.threadClass ?? ""),
      endType: field("End type", feature?.lengthMillimeters === undefined ? "up-to-next" : "blind", ["blind", "up-to-next"]),
      length: field("Length (mm)", feature?.lengthMillimeters === undefined ? "10" : String(feature.lengthMillimeters)),
    };
  },
  layout(context, controls) {
    const { win, form, lengthUnitLabel } = context;
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    const row = (label: string, control: Controls[string], unit?: string) => { control.closest("label")?.remove(); control.setAttribute("form", form.id); const r = unit ? rowIn(label, control, unitSuffix(unit)) : rowIn(label, control); win.body.append(r); return r; };
    const faces = mountPickedReferences<SolidFaceReference>(context, controls.face, {
      title: "Cylindrical face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
      note: "Pick the convex cylindrical face (Onshape picks its edges). The thread is cosmetic: the model is unchanged and the tree lists it.",
      onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); },
    });
    row("Standard", controls.standard);
    row("Size", controls.designation);
    // Threads per inch or Pitch follow the size, as Onshape's.
    const pitch = document.createElement("input"); pitch.type = "text"; pitch.readOnly = true; pitch.setAttribute("aria-label", "Pitch");
    const pitchRow = win.body.appendChild(rowIn("Pitch", pitch));
    row("Thread class", controls.threadClass);
    hide(controls.endType);
    const ends = { Blind: "blind", "Up to next": "up-to-next" } as const;
    const picker = win.picker(Object.keys(ends), { ariaLabel: "End type menu", onChange: (text) => { controls.endType.value = ends[text as keyof typeof ends]; sync(); controls.endType.dispatchEvent(new Event("change")); } });
    picker.setValue(controls.endType.value === "blind" ? "Blind" : "Up to next");
    win.body.append(rowIn("End type", picker.element));
    const length = row("Length", controls.length, lengthUnitLabel);
    const gap = (label: string, reason: string, fields: string[]) => {
      const section = win.subsection(label, { kind: "checkbox", open: false });
      for (const name of fields) { const input = document.createElement("input"); input.type = "text"; input.setAttribute("aria-label", name); section.body.append(rowIn(name, input)); }
      planned(section.element, reason); win.body.append(section.element);
    };
    gap("Add chamfer", chamferGap, ["Chamfer distance", "Chamfer angle"]);
    gap("Add undercut", undercutGap, ["Undercut diameter", "Undercut length"]);
    const split = document.createElement("input"); split.type = "checkbox"; split.setAttribute("aria-label", "Split face");
    win.body.append(planned(rowIn("Split face", split), splitGap));
    const sync = () => {
      const standard = standardFor(controls.standard.value), spec = standard ? threadSpecification(standard, controls.designation.value) : undefined;
      const typed = /^M\d+(?:\.\d+)?x(\d+(?:\.\d+)?)$/i.exec(controls.designation.value.trim());
      const inch = standard === "unc" || standard === "unf" || standard === "npt";
      pitchRow.querySelector("span")!.textContent = inch ? "Threads per inch" : "Pitch";
      const mm = spec?.pitchMillimeters ?? (typed ? Number(typed[1]) : undefined);
      pitch.value = mm === undefined ? "" : inch ? String(Number((25.4 / mm).toFixed(2))) : `${mm} mm`;
      length.hidden = controls.endType.value !== "blind";
    };
    for (const key of ["standard", "designation", "endType"]) controls[key].addEventListener("change", sync);
    controls.designation.addEventListener("input", sync);
    sync();
  },
  validate(controls) {
    const face = JSON.parse(controls.face.value)[0] as SolidFaceReference | undefined;
    if (!face) return "Pick the cylindrical face.";
    if (face.surfaceType !== "cylinder") return "The thread face must be cylindrical.";
    const standard = standardFor(controls.standard.value);
    if (standard && !threadSpecification(standard, controls.designation.value)) return `Use a ${HOLE_THREAD_STANDARD_LABELS[standard]} size such as ${threadDesignations(standard)[4] ?? threadDesignations(standard)[0]}.`;
    if (!standard && !/^M\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?$/i.test(controls.designation.value.trim())) return "Use an ISO metric size such as M8 or M8x1.";
    if (controls.threadClass.value.trim() && !threadClasses(standard ?? "iso-metric-coarse").includes(controls.threadClass.value.trim())) return `Thread class must be one of ${threadClasses(standard ?? "iso-metric-coarse").join(", ") || "none for a pipe thread"}.`;
    if (controls.endType.value === "blind" && !(Number(controls.length.value) > 0)) return "Enter a positive length.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    const standard = standardFor(values.standard);
    return { face, designation: values.designation.trim(), ...(standard ? { standard } : {}), ...(values.threadClass?.trim() ? { threadClass: values.threadClass.trim() } : {}), ...(values.endType === "blind" ? { lengthMillimeters: Number(values.length) } : {}) };
  },
};
