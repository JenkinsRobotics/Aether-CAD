/** External thread, as Onshape's (help: PartStudio/external_thread.htm): the cylinder, Standard,
 *  Size (or from the cylinder's diameter), Threads per inch or Pitch, End type (Blind with Length,
 *  or Up to next), Add chamfer, Add undercut and Split face. The thread itself is cosmetic here as
 *  in Onshape; the chamfer, undercut and face split change the part. This kernel takes the
 *  cylindrical face (Onshape takes its circular edges). */
import { HOLE_THREAD_STANDARDS, HOLE_THREAD_STANDARD_LABELS, threadClasses, threadDesignations, threadSpecification, type HoleThreadStandard, type SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { checkRow, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const FREE = "ISO metric (typed)";
const standardFor = (label: string): HoleThreadStandard | undefined => HOLE_THREAD_STANDARDS.find((s) => HOLE_THREAD_STANDARD_LABELS[s] === label);

export const threadEditor: FeatureEditor = {
  type: "thread",
  controls({ field, feature }: FeatureEditorContext): Controls {
    return {
      face: field("Thread face", JSON.stringify(feature?.face ? [feature.face] : [])),
      standard: field("Standard", feature?.standard ? HOLE_THREAD_STANDARD_LABELS[feature.standard as HoleThreadStandard] : FREE, [FREE, ...HOLE_THREAD_STANDARDS.map((s) => HOLE_THREAD_STANDARD_LABELS[s])]),
      designation: field("Size", feature?.designation ?? "M8"),
      sizeFromFace: field("Size from face", feature?.sizeFromFace ? "true" : "false", ["false", "true"]),
      chamferOn: field("Add chamfer", feature?.chamfer ? "true" : "false", ["false", "true"]),
      chamferDistance: field("Chamfer distance (mm)", String(feature?.chamfer?.distanceMillimeters ?? 1)),
      chamferAngle: field("Chamfer angle (degrees)", String(feature?.chamfer?.angleDegrees ?? 45)),
      undercutOn: field("Add undercut", feature?.undercut ? "true" : "false", ["false", "true"]),
      undercutDiameter: field("Undercut diameter (mm)", String(feature?.undercut?.diameterMillimeters ?? 6)),
      undercutLength: field("Undercut length (mm)", String(feature?.undercut?.lengthMillimeters ?? 2)),
      splitFace: field("Split face", feature?.splitFace ? "true" : "false", ["false", "true"]),
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
    const sizeRow = row("Size", controls.designation);
    const fromFace = checkRow(context, controls.sizeFromFace, "Size from the cylinder's diameter", () => sync());
    hide(controls.chamferOn); hide(controls.undercutOn);
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
    const option = (label: string, flag: Controls[string], rows: [string, Controls[string], string][]) => {
      const section = win.subsection(label, { kind: "checkbox", open: flag.value === "true", onToggle: (open) => { flag.value = String(open); sync(); flag.dispatchEvent(new Event("change")); } });
      for (const [name, control, unit] of rows) { control.closest("label")?.remove(); control.setAttribute("form", form.id); section.body.append(rowIn(name, control, unitSuffix(unit))); }
      win.body.append(section.element); return section;
    };
    option("Add chamfer", controls.chamferOn, [["Chamfer distance", controls.chamferDistance, lengthUnitLabel], ["Chamfer angle", controls.chamferAngle, context.angleUnitLabel]]);
    const undercut = option("Add undercut", controls.undercutOn, [["Undercut diameter", controls.undercutDiameter, lengthUnitLabel], ["Undercut length", controls.undercutLength, lengthUnitLabel]]);
    const split = checkRow(context, controls.splitFace, "Split face");
    const sync = () => {
      const standard = standardFor(controls.standard.value);
      // Size from the cylinder: the standard's size whose major diameter is nearest the picked face's.
      const picked = JSON.parse(controls.face.value || "[]")[0] as (SolidFaceReference & { radiusMillimeters?: number }) | undefined;
      if (standard && controls.sizeFromFace.value === "true" && picked?.radiusMillimeters) {
        const nearest = threadDesignations(standard).map((d) => ({ d, spec: threadSpecification(standard, d)! })).sort((a, b) => Math.abs(a.spec.majorDiameterMillimeters - 2 * picked.radiusMillimeters!) - Math.abs(b.spec.majorDiameterMillimeters - 2 * picked.radiusMillimeters!))[0];
        if (nearest) controls.designation.value = nearest.d;
      }
      const spec = standard ? threadSpecification(standard, controls.designation.value) : undefined;
      const typed = /^M\d+(?:\.\d+)?x(\d+(?:\.\d+)?)$/i.exec(controls.designation.value.trim());
      const inch = standard === "unc" || standard === "unf" || standard === "npt";
      pitchRow.querySelector("span")!.textContent = inch ? "Threads per inch" : "Pitch";
      const mm = spec?.pitchMillimeters ?? (typed ? Number(typed[1]) : undefined);
      pitch.value = mm === undefined ? "" : inch ? String(Number((25.4 / mm).toFixed(2))) : `${mm} mm`;
      length.hidden = controls.endType.value !== "blind";
      // Size from the face needs a standard's table; a Blind length is where the undercut and split sit.
      fromFace.hidden = !standard; sizeRow.hidden = Boolean(standard) && controls.sizeFromFace.value === "true";
      undercut.element.hidden = controls.endType.value !== "blind"; split.hidden = controls.endType.value !== "blind";
    };
    for (const key of ["standard", "designation", "endType", "face", "sizeFromFace"]) controls[key].addEventListener("change", sync);
    controls.designation.addEventListener("input", sync);
    sync();
  },
  validate(controls) {
    const face = JSON.parse(controls.face.value)[0] as SolidFaceReference | undefined;
    if (!face) return "Pick the cylindrical face.";
    if (face.surfaceType !== "cylinder") return "The thread face must be cylindrical.";
    const standard = standardFor(controls.standard.value), fromFace = Boolean(standard) && controls.sizeFromFace.value === "true";
    if (fromFace && !(JSON.parse(controls.face.value || "[]")[0]?.radiusMillimeters > 0)) return "The picked face carries no radius; pick the cylindrical face again.";
    if (standard && !threadSpecification(standard, controls.designation.value)) return `Use a ${HOLE_THREAD_STANDARD_LABELS[standard]} size such as ${threadDesignations(standard)[4] ?? threadDesignations(standard)[0]}.`;
    if (controls.chamferOn.value === "true" && !(Number(controls.chamferDistance.value) > 0 && Number(controls.chamferAngle.value) > 0 && Number(controls.chamferAngle.value) < 90)) return "Enter a positive chamfer distance and an angle below 90 degrees.";
    if (controls.endType.value === "blind" && controls.undercutOn.value === "true" && !(Number(controls.undercutDiameter.value) > 0 && Number(controls.undercutLength.value) > 0)) return "Enter a positive undercut diameter and length.";
    if (!standard && !/^M\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?$/i.test(controls.designation.value.trim())) return "Use an ISO metric size such as M8 or M8x1.";
    if (controls.threadClass.value.trim() && !threadClasses(standard ?? "iso-metric-coarse").includes(controls.threadClass.value.trim())) return `Thread class must be one of ${threadClasses(standard ?? "iso-metric-coarse").join(", ") || "none for a pipe thread"}.`;
    if (controls.endType.value === "blind" && !(Number(controls.length.value) > 0)) return "Enter a positive length.";
    return null;
  },
  serialize(values) {
    const face = JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown }; delete face.centerMillimeters;
    const standard = standardFor(values.standard), blind = values.endType === "blind", fromFace = Boolean(standard) && values.sizeFromFace === "true";
    return { face, designation: values.designation.trim(), ...(standard ? { standard } : {}), ...(fromFace ? { sizeFromFace: true } : {}), ...(values.threadClass?.trim() ? { threadClass: values.threadClass.trim() } : {}), ...(blind ? { lengthMillimeters: Number(values.length) } : {}),
      ...(values.chamferOn === "true" ? { chamfer: { distanceMillimeters: Number(values.chamferDistance), angleDegrees: Number(values.chamferAngle) } } : {}),
      ...(blind && values.undercutOn === "true" ? { undercut: { diameterMillimeters: Number(values.undercutDiameter), lengthMillimeters: Number(values.undercutLength) } } : {}),
      ...(blind && values.splitFace === "true" ? { splitFace: true } : {}), targetBodyId: face.bodyId };
  },
};
