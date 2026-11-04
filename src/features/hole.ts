/** Hole, as Onshape's (help: hole.htm): Metric / Inch, Simple / Counterbore / Countersink, Sketch
 *  points to place holes, Merge scope, Hole type (Drilled / Clearance / Tapped / PEM) with its
 *  standard, size, fit and thread class, Diameter, Start plane, Termination (Blind / Up to next /
 *  Up to entity / Through all with the flip), the counterbore, countersink and tapped depths, and
 *  the Tip angle style. Controls this kernel cannot honour are present and refuse with the gap
 *  named: PEM fasteners, pipe taps, Start from part / selected plane and the Up-to terminations
 *  (ledger: Hole). Aether's own options (modelled thread, hand, taper, drill direction, head from
 *  standard) sit in a closed disclosure at the end. Holes of saved documents placed on a circular
 *  sketch region or a face point keep their boxes. */
import {
  HOLE_THREAD_STANDARDS, HOLE_THREAD_STANDARD_LABELS, capScrewCounterboreFor, countersunkScrewFor, sketchRegions,
  standardHoleDiameter, threadClasses, threadDesignations, threadSpecification,
  type HoleClearanceFit, type HoleThread, type HoleThreadStandard, type SolidFaceReference,
} from "@aether/core/document";
import { availableBodies } from "@aether/core/document";
import { layoutRegion, regionControls, stampProfileSelections } from "./regions";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { mountPartBox } from "./part-box";
import { mountSketchPointsBox } from "./sketch-points-box";
import { serializeExtrusionPoint } from "./extrude-point-picker";
import { checkRow, entityChips, iconButton, rowIn, unitSuffix, type Control, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const CUSTOM = "custom";
const standardLabel = (standard: HoleThreadStandard) => HOLE_THREAD_STANDARD_LABELS[standard];
const standardFor = (label: string) => HOLE_THREAD_STANDARDS.find((standard) => standardLabel(standard) === label);
const metric = (standard: HoleThreadStandard) => standard.startsWith("iso-metric") || standard === "bsp";
const pemGap = "Not available in this kernel: PEM® self-clinching fastener holes are a recorded gap.";
const pipeGap = "Not available in this kernel: pipe taps through the Hole type are a recorded gap (BSP and NPT threads are available as a tapped Standard).";
const startGap = "Not available in this kernel: a hole starts at its sketch plane; Start from part and Start from selected plane are a recorded gap.";
const terminationGap = "Not available in this kernel: Up to next and Up to entity terminations are a recorded gap (Blind and Through all are available).";

/** Sets a length field from a canonical millimetre value, in the document's display unit. */
function setLength(control: Control, millimeters: number): void {
  const factor = Number(control.dataset.canonicalFactor ?? 1);
  control.value = String(Number((millimeters / factor).toFixed(4)));
}

export const holeEditor: FeatureEditor = {
  type: "hole",

  controls(context): Controls {
    const { field, reference, feature, doc, lengthUnitLabel } = context;
    const source = reference("Center sketch", ["profile", "sketch"], feature?.profileFeatureId);
    const placement = feature?.placement;
    const thread: HoleThread | undefined = feature?.thread;
    const legacy = placement?.kind === "face-point" ? "face" : feature && placement?.kind !== "sketch-points" ? "sketch" : "points";
    const tip = feature?.drillPoint === "angled" ? (Math.abs((feature.drillPointAngleDegrees ?? 118) - 118) < 1e-9 ? "118" : Math.abs((feature.drillPointAngleDegrees ?? 118) - 135) < 1e-9 ? "135" : "custom") : "flat";
    return {
      placement: field("Placement", legacy, ["points", "sketch", "face"]),
      points: field("Sketch points", JSON.stringify(placement?.kind === "sketch-points" ? placement.points : [])),
      source, region: regionControls(context, source, "Circular region", false, true),
      allCircles: field("Every circle of the sketch", feature?.allCircles ? "yes" : "no", ["no", "yes"]),
      face: field("Hole face", JSON.stringify(placement?.kind === "face-point" ? [placement.face] : [])),
      pointX: field("Point X (mm)", String(placement?.kind === "face-point" ? placement.pointMillimeters[0] : 0)),
      pointY: field("Point Y (mm)", String(placement?.kind === "face-point" ? placement.pointMillimeters[1] : 0)),
      pointZ: field("Point Z (mm)", String(placement?.kind === "face-point" ? placement.pointMillimeters[2] : 0)),
      mergeScope: field("Merge scope part", JSON.stringify(feature?.targetBodyId ? [feature.targetBodyId] : availableBodies(doc).at(-1) ? [availableBodies(doc).at(-1)!.id] : [])),
      units: field("Units", thread ? (metric(thread.standard) ? "metric" : "inch") : lengthUnitLabel === "in" ? "inch" : "metric", ["metric", "inch"]),
      holeType: field("Hole type", thread ? (thread.tapped ? "tapped" : "clearance") : "drilled", ["drilled", "clearance", "tapped", "pem"]),
      tapType: field("Tap type", "straight", ["straight", "straight-pipe", "tapered-pipe"]),
      profile: field("Standard", thread ? standardLabel(thread.standard) : CUSTOM, [CUSTOM, ...HOLE_THREAD_STANDARDS.map(standardLabel)]),
      size: field("Size", thread?.designation ?? "M6", thread ? threadDesignations(thread.standard) : threadDesignations("iso-metric-coarse")),
      threaded: field("Thread", thread ? (thread.tapped ? "tapped" : "clearance") : "tapped", ["tapped", "clearance"]),
      fit: field("Fastener fit", thread?.fit ?? "normal", ["close", "normal", "loose"]),
      threadClassOn: field("Thread class on", thread?.threadClass ? "true" : "false", ["false", "true"]),
      threadClass: field("Thread class", thread?.threadClass ?? "", ["", ...threadClasses(thread?.standard ?? "iso-metric-coarse")]),
      threadModel: field("Thread geometry", thread?.modeled ? "modelled" : "cosmetic", ["cosmetic", "modelled"]),
      threadHand: field("Thread hand", thread?.leftHand ? "left" : "right", ["right", "left"]),
      threadDepthType: field("Thread depth", thread?.depthMillimeters !== undefined ? "dimension" : "whole hole", ["whole hole", "dimension"]),
      threadDepth: field("Tapped depth (mm)", String(thread?.depthMillimeters ?? 8)),
      cutType: field("Hole style", feature?.cutType ?? "plain", ["plain", "counterbore", "countersink", "counterdrill"]),
      head: field("Head from standard", "manual", ["manual", "ISO 4762 cap screw counterbore", "ISO 10642 countersunk screw"]),
      diameter: field("Diameter (mm)", String(feature?.diameterMillimeters ?? 6)),
      startPlane: field("Start plane", "sketch", ["part", "sketch", "selected"]),
      depthType: field("Termination", feature?.depthType ?? "blind", ["blind", "up-to-next", "up-to-entity", "through-all"]),
      depth: field("Depth (mm)", String(feature?.depthMillimeters ?? 10)),
      tipStyle: field("Tip angle style", tip, ["118", "135", "flat", "custom"]),
      drillPointAngle: field("Tip angle (degrees)", String(feature?.drillPointAngleDegrees ?? 118)),
      taper: field("Taper (degrees)", String(feature?.taperAngleDegrees ?? 0)),
      counterDiameter: field("Counterbore diameter (mm)", String(feature?.counterDiameterMillimeters ?? 10)),
      counterDepth: field("Counterbore depth (mm)", String(feature?.counterDepthMillimeters ?? 2)),
      countersinkAngle: field("Countersink angle (degrees)", String(feature?.countersinkAngleDegrees ?? 90)),
      direction: field("Direction", feature?.reversed ? "reverse" : "normal", ["normal", "reverse"]),
      drillMode: field("Drill direction", feature?.direction ? "custom" : "square", ["square", "custom"]),
      drillX: field("Drill X", String(feature?.direction?.[0] ?? 0)), drillY: field("Drill Y", String(feature?.direction?.[1] ?? 0)), drillZ: field("Drill Z", String(feature?.direction?.[2] ?? -1)),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, feature, doc, lengthUnitLabel, angleUnitLabel } = context;
    const hide = (control: Control) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    const row = (label: string, control: Control, unit?: string) => { control.closest("label")?.remove(); control.setAttribute("form", form.id); const r = unit ? rowIn(label, control, unitSuffix(unit)) : rowIn(label, control); win.body.append(r); return r; };
    for (const control of Object.values(controls)) if (control instanceof window.HTMLElement && control.closest("label")) hide(control);
    const picker = (label: string, control: Control, options: Record<string, string>, ariaLabel: string, onChange?: () => void) => {
      const byValue = Object.fromEntries(Object.entries(options).map(([text, value]) => [value, text]));
      const p = win.picker(Object.keys(options), { ariaLabel, onChange: (text) => { control.value = options[text]; onChange?.(); sync(); control.dispatchEvent(new Event("change")); } });
      p.setValue(byValue[control.value] ?? Object.keys(options)[0]);
      control.addEventListener("change", () => p.setValue(byValue[control.value] ?? Object.keys(options)[0]));
      const r = rowIn(label, p.element); win.body.append(r); return r;
    };

    // Metric / Inch, then Simple / Counterbore / Countersink.
    const unitTabs = win.tabs(["Metric", "Inch"], controls.units.value === "inch" ? 1 : 0);
    [...unitTabs.children].forEach((tab, index) => { (tab as HTMLButtonElement).onclick = () => { controls.units.value = index ? "inch" : "metric"; [...unitTabs.children].forEach((o, i) => o.classList.toggle("active", i === index)); familyChanged(); sync(); controls.units.dispatchEvent(new Event("change")); }; });
    const styles = feature?.cutType === "counterdrill" ? ["Simple", "Counterbore", "Countersink", "Counterdrill"] : ["Simple", "Counterbore", "Countersink"];
    const styleValues = ["plain", "counterbore", "countersink", "counterdrill"];
    const styleTabs = win.tabs(styles, Math.max(0, styleValues.indexOf(controls.cutType.value)));
    [...styleTabs.children].forEach((tab, index) => { (tab as HTMLButtonElement).onclick = () => { controls.cutType.value = styleValues[index]; [...styleTabs.children].forEach((o, i) => o.classList.toggle("active", i === index)); sync(); controls.cutType.dispatchEvent(new Event("change")); }; });
    win.body.append(unitTabs, styleTabs);

    // Placement: sketch points (Onshape); saved documents may still place on a circular region or a face point.
    const points = mountSketchPointsBox(context, controls.points, "Sketch points to place holes");
    const legacy = controls.placement.value !== "points";
    let regionBox: HTMLElement | undefined, faceBox: HTMLElement | undefined, sourceRow: HTMLElement | undefined;
    if (legacy) {
      sourceRow = row("Center sketch", controls.source);
      layoutRegion(context, controls.source, controls.region);
      regionBox = entityChips(win, "Circular region", controls.region, form).element;
      const faces = mountPickedReferences<SolidFaceReference & { centerMillimeters?: [number, number, number] }>(context, controls.face, {
        title: "Hole face", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
        onChange: (picked) => { if (picked.length > 1) { faces.update([picked[picked.length - 1]]); return; } const c = picked[0]?.centerMillimeters; if (c) { controls.pointX.value = String(c[0]); controls.pointY.value = String(c[1]); controls.pointZ.value = String(c[2]); } },
      });
      faceBox = faces.element;
    }
    points.element.hidden = legacy;

    // Merge scope: the part the holes cut.
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const scope = mountPartBox(context, controls.mergeScope, "Merge scope", bodies, () => "", { single: true });
    win.body.append(scope.element);
    controls.mergeScope.addEventListener("change", () => { const id = JSON.parse(controls.mergeScope.value || "[]")[0]; if (id) { controls.target.value = id; controls.target.dispatchEvent(new Event("change")); } });

    // Hole type and its standard, size, fit and class.
    picker("Hole type", controls.holeType, { Drilled: "drilled", Clearance: "clearance", Tapped: "tapped", "PEM®": "pem" }, "Hole type menu", () => { familyChanged(); });
    const tapRow = picker("Tap type", controls.tapType, { "Straight tap": "straight", "Straight pipe tap": "straight-pipe", "Tapered pipe tap": "tapered-pipe" }, "Tap type menu");
    const standardRow = row("Standard", controls.profile);
    const sizeRow = row("Size", controls.size);
    const fitRow = picker("Fastener fit", controls.fit, { Close: "close", Normal: "normal", Loose: "loose" }, "Fastener fit menu");
    const classRow = checkRow(context, controls.threadClassOn, "Thread class");
    const classValue = row("Class", controls.threadClass);
    row("Diameter", controls.diameter, lengthUnitLabel);
    picker("Start plane", controls.startPlane, { "Start from part": "part", "Start from sketch plane": "sketch", "Start from selected plane": "selected" }, "Start plane menu");
    // Termination and its flip.
    const terminationRow = picker("Termination", controls.depthType, { Blind: "blind", "Up to next": "up-to-next", "Up to entity": "up-to-entity", "Through all": "through-all" }, "Termination menu");
    const flip = iconButton("flip-horizontal", "Opposite direction");
    const paintFlip = () => flip.setAttribute("aria-pressed", String(controls.direction.value === "reverse"));
    flip.onclick = () => { controls.direction.value = controls.direction.value === "reverse" ? "normal" : "reverse"; paintFlip(); controls.direction.dispatchEvent(new Event("change")); };
    paintFlip(); terminationRow.querySelector(".aui-feature-row-control")?.append(flip);
    const depthRow = row("Depth", controls.depth, lengthUnitLabel);
    const boreDiameter = row("Counterbore diameter", controls.counterDiameter, lengthUnitLabel);
    const boreDepth = row("Counterbore depth", controls.counterDepth, lengthUnitLabel);
    const sinkAngle = row("Countersink angle", controls.countersinkAngle, angleUnitLabel);
    const tapThrough = document.createElement("input"); tapThrough.type = "checkbox"; tapThrough.setAttribute("aria-label", "Tap through all");
    const tapThroughRow = rowIn("Tap through all", tapThrough); win.body.append(tapThroughRow);
    tapThrough.onchange = () => { controls.threadDepthType.value = tapThrough.checked ? "whole hole" : "dimension"; sync(); controls.threadDepthType.dispatchEvent(new Event("change")); };
    const tapDepth = row("Tapped depth", controls.threadDepth, lengthUnitLabel);
    picker("Tip angle style", controls.tipStyle, { "118 degrees": "118", "135 degrees": "135", Flat: "flat", Custom: "custom" }, "Tip angle style menu");
    const tipAngle = row("Tip angle", controls.drillPointAngle, angleUnitLabel);
    // Aether's own options, beyond Onshape's dialog.
    const more = win.subsection("Aether options", { kind: "disclosure", open: false });
    const into = (label: string, control: Control, unit?: string) => { control.closest("label")?.remove(); control.setAttribute("form", form.id); const r = unit ? rowIn(label, control, unitSuffix(unit)) : rowIn(label, control); more.body.append(r); return r; };
    const modelRow = into("Thread geometry", controls.threadModel), handRow = into("Thread hand", controls.threadHand);
    into("Taper", controls.taper, angleUnitLabel);
    into("Drill direction", controls.drillMode);
    const drillRows = [into("Drill X", controls.drillX), into("Drill Y", controls.drillY), into("Drill Z", controls.drillZ)];
    const headRow = into("Head from standard", controls.head);
    const sinkDiameterNote = document.createElement("p"); sinkDiameterNote.textContent = "Countersink diameter is the Counterbore diameter row for a countersunk hole."; win.addHelp(sinkDiameterNote);
    win.body.append(more.element);

    const standard = () => standardFor(controls.profile.value);
    const spec = () => { const s = standard(); return s ? threadSpecification(s, controls.size.value) : undefined; };
    const refillSizes = () => {
      const s = standard(); if (!s || !(controls.size instanceof window.HTMLSelectElement)) return;
      const wanted = controls.size.value;
      controls.size.replaceChildren(...threadDesignations(s).map((d) => Object.assign(document.createElement("option"), { value: d, textContent: d })));
      controls.size.value = threadDesignations(s).includes(wanted) ? wanted : threadDesignations(s)[Math.min(4, threadDesignations(s).length - 1)];
      if (controls.threadClass instanceof window.HTMLSelectElement) { const cls = controls.threadClass.value; controls.threadClass.replaceChildren(...["", ...threadClasses(s)].map((v) => Object.assign(document.createElement("option"), { value: v, textContent: v || "default" }))); controls.threadClass.value = threadClasses(s).includes(cls) ? cls : ""; }
    };
    // A standard drives the diameter: tap drill when tapped, the fit when clearance.
    const applyDiameter = () => {
      const s = spec(); const input = controls.diameter as HTMLInputElement;
      input.readOnly = Boolean(s);
      if (s) setLength(controls.diameter, standardHoleDiameter(s, controls.threaded.value === "tapped", controls.fit.value as HoleClearanceFit, controls.threadClassOn.value === "true" ? controls.threadClass.value || undefined : undefined));
    };
    const applyHead = () => {
      const s = spec(); if (!s || controls.head.value === "manual") return;
      const recess = controls.head.value.startsWith("ISO 4762") ? capScrewCounterboreFor(s) : countersunkScrewFor(s);
      if (!recess) return;
      controls.cutType.value = recess.depthMillimeters !== undefined ? "counterbore" : "countersink";
      [...styleTabs.children].forEach((o, i) => o.classList.toggle("active", styleValues[i] === controls.cutType.value));
      setLength(controls.counterDiameter, recess.diameterMillimeters);
      if (recess.depthMillimeters !== undefined) setLength(controls.counterDepth, recess.depthMillimeters);
      if (recess.angleDegrees !== undefined) controls.countersinkAngle.value = String(recess.angleDegrees / Number(controls.countersinkAngle.dataset.canonicalFactor ?? 1));
    };
    // Drilled has no standard; Clearance and Tapped take the family of the Metric / Inch tab.
    const familyChanged = () => {
      const type = controls.holeType.value;
      if (type === "drilled" || type === "pem") { controls.profile.value = CUSTOM; }
      else {
        const family = controls.units.value === "inch" ? ["unc", "unf", "npt"] : ["iso-metric-coarse", "iso-metric-fine", "bsp"];
        if (!family.includes(standard() ?? "")) controls.profile.value = standardLabel(family[0] as HoleThreadStandard);
        controls.threaded.value = type === "tapped" ? "tapped" : "clearance";
      }
      refillSizes(); applyDiameter(); applyHead();
    };
    const sync = () => {
      const type = controls.holeType.value, threaded = type === "clearance" || type === "tapped", tapped = type === "tapped";
      const blind = controls.depthType.value === "blind", counterbored = controls.cutType.value === "counterbore" || controls.cutType.value === "counterdrill", countersunk = controls.cutType.value === "countersink" || controls.cutType.value === "counterdrill";
      if (sourceRow) sourceRow.hidden = controls.placement.value !== "sketch";
      if (regionBox) regionBox.hidden = controls.placement.value !== "sketch" || controls.allCircles.value === "yes";
      if (faceBox) faceBox.hidden = controls.placement.value !== "face";
      tapRow.hidden = !tapped; standardRow.hidden = !threaded; sizeRow.hidden = !threaded; fitRow.hidden = type !== "clearance";
      classRow.hidden = !tapped || !threadClasses(standard() ?? "iso-metric-coarse").length; classValue.hidden = classRow.hidden || controls.threadClassOn.value !== "true";
      depthRow.hidden = !blind; boreDiameter.hidden = controls.cutType.value === "plain"; boreDepth.hidden = !counterbored; sinkAngle.hidden = !countersunk;
      boreDiameter.querySelector("span")!.textContent = countersunk && !counterbored ? "Countersink diameter" : "Counterbore diameter";
      tapThroughRow.hidden = !tapped || controls.depthType.value !== "through-all"; tapThrough.checked = controls.threadDepthType.value === "whole hole";
      tapDepth.hidden = !tapped || (controls.depthType.value === "through-all" && controls.threadDepthType.value === "whole hole") || (blind && controls.threadDepthType.value === "whole hole" && false);
      tipAngle.hidden = controls.tipStyle.value !== "custom";
      modelRow.hidden = !tapped; handRow.hidden = !tapped || controls.threadModel.value !== "modelled";
      for (const r of drillRows) r.hidden = controls.drillMode.value !== "custom";
      headRow.hidden = !threaded || !(standard() ?? "").startsWith("iso-metric");
    };
    controls.profile.addEventListener("change", () => { refillSizes(); applyDiameter(); applyHead(); sync(); });
    for (const key of ["size", "fit", "threadClass", "threadClassOn"]) controls[key].addEventListener("change", () => { applyDiameter(); applyHead(); sync(); });
    controls.head.addEventListener("change", () => { applyHead(); sync(); });
    for (const key of ["holeType", "units"]) controls[key].addEventListener("change", () => { familyChanged(); sync(); });
    for (const key of ["placement", "allCircles", "threadDepthType", "threadModel", "drillMode", "tipStyle", "depthType", "cutType"]) controls[key].addEventListener("change", sync);
    familyChanged(); sync();
  },

  validate(controls, context) {
    const type = controls.holeType.value;
    if (type === "pem") return pemGap;
    if (type === "tapped" && controls.tapType.value !== "straight") return pipeGap;
    if (controls.startPlane.value !== "sketch") return startGap;
    if (!["blind", "through-all"].includes(controls.depthType.value)) return terminationGap;
    if (!JSON.parse(controls.mergeScope.value || "[]").length) return "Select the merge scope part.";
    if (controls.drillMode.value === "custom" && Math.hypot(Number(controls.drillX.value), Number(controls.drillY.value), Number(controls.drillZ.value)) < 1e-9) return "Enter a nonzero drill direction.";
    const standard = standardFor(controls.profile.value);
    if (type !== "drilled" && !standard) return "Choose a thread standard.";
    if (standard && !threadSpecification(standard, controls.size.value)) return `Choose a ${HOLE_THREAD_STANDARD_LABELS[standard]} size.`;
    if (!(Number(controls.diameter.value) > 0)) return "Enter a positive diameter.";
    if (controls.depthType.value === "blind" && !(Number(controls.depth.value) > 0)) return "Enter a positive depth.";
    if (type === "tapped" && controls.threadDepthType.value === "dimension" && !(Number(controls.threadDepth.value) > 0)) return "Tapped depth must be positive.";
    if (controls.tipStyle.value === "custom" && !(Number(controls.drillPointAngle.value) > 0 && Number(controls.drillPointAngle.value) < 180)) return "Tip angle must be between 0 and 180 degrees.";
    if (!(Number(controls.taper.value) >= 0 && Number(controls.taper.value) < 45)) return "Taper must be between 0 and 45 degrees.";
    if (controls.placement.value === "points") return JSON.parse(controls.points.value || "[]").length ? null : "Select the sketch points to place holes.";
    if (controls.placement.value === "face") {
      if (!JSON.parse(controls.face.value || "[]").length) return "Pick the face to drill into.";
      return [controls.pointX, controls.pointY, controls.pointZ].every((c) => Number.isFinite(Number(c.value))) ? null : "Enter a finite hole point.";
    }
    if (!controls.source.value) return "Choose a center sketch.";
    const sketch = context.doc.features.find((f) => f.id === controls.source.value);
    if (controls.allCircles.value === "yes") return sketch && sketchRegions(sketch, true, context.doc.features).some((r) => r.circle) ? null : "The sketch has no circles.";
    const region = sketch && sketchRegions(sketch, true, context.doc.features).find((r) => String(r.contourIndex) === controls.region.value);
    return region?.circle ? null : "Choose a circular sketch region for the hole center.";
  },

  serialize(values, context) {
    const type = values.holeType, standard = type === "drilled" ? undefined : standardFor(values.profile), tapped = type === "tapped";
    const thread: HoleThread | undefined = standard ? {
      standard, designation: values.size, tapped,
      ...(tapped ? {} : { fit: values.fit as HoleClearanceFit }),
      ...(tapped && values.threadClassOn === "true" && values.threadClass ? { threadClass: values.threadClass } : {}),
      ...(tapped && values.threadModel === "modelled" ? { modeled: true, ...(values.threadHand === "left" ? { leftHand: true } : {}) } : {}),
      ...(tapped && values.threadDepthType === "dimension" ? { depthMillimeters: Number(values.threadDepth) } : {}),
    } : undefined;
    const counterbored = values.cutType === "counterbore" || values.cutType === "counterdrill";
    const countersunk = values.cutType === "countersink" || values.cutType === "counterdrill";
    const points = values.placement === "points" ? (JSON.parse(values.points || "[]") as unknown[]).map((ref) => serializeExtrusionPoint(JSON.stringify(ref), context)) : [];
    const picked = values.placement === "face" ? JSON.parse(values.face)[0] as SolidFaceReference & { centerMillimeters?: unknown } : undefined;
    if (picked) delete picked.centerMillimeters;
    const angled = values.tipStyle !== "flat";
    return {
      ...(values.placement === "points" ? { placement: { kind: "sketch-points", points } }
        : values.placement === "face" ? { placement: { kind: "face-point", face: picked, pointMillimeters: [Number(values.pointX), Number(values.pointY), Number(values.pointZ)] } }
        : values.allCircles === "yes" ? { profileFeatureId: values.source, allCircles: true } : stampProfileSelections(context, [{ featureId: values.source, contourIndex: Number(values.region) }], true)[0]),
      targetBodyId: JSON.parse(values.mergeScope || "[]")[0],
      cutType: values.cutType, diameterMillimeters: Number(values.diameter),
      depthType: values.depthType, depthMillimeters: Number(values.depth),
      ...(values.cutType !== "plain" ? { counterDiameterMillimeters: Number(values.counterDiameter) } : {}),
      ...(counterbored ? { counterDepthMillimeters: Number(values.counterDepth) } : {}),
      ...(countersunk ? { countersinkAngleDegrees: Number(values.countersinkAngle) } : {}),
      ...(thread ? { thread } : {}),
      ...(values.depthType === "blind" && angled ? { drillPoint: "angled", drillPointAngleDegrees: values.tipStyle === "custom" ? Number(values.drillPointAngle) : Number(values.tipStyle) } : {}),
      ...(Number(values.taper) > 0 && !thread?.modeled ? { taperAngleDegrees: Number(values.taper) } : {}),
      reversed: values.direction === "reverse",
      ...(values.drillMode === "custom" ? { direction: [Number(values.drillX), Number(values.drillY), Number(values.drillZ)] } : {}),
    };
  },
};
