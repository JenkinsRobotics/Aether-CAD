/** Split, as Onshape's (help: PartStudio/split.htm): the Part / Face switch (the window's first
 *  row, which opens the Face split feature), Parts to split, Entity to split with (a tree plane, a
 *  Plane feature, a planar face or a straight sketch line), Keep tools, Trim to face boundaries,
 *  Keep both sides and the Opposite direction arrow. This kernel splits one part by a plane: Keep
 *  tools and Trim to face boundaries are present and disabled with the gap named (ledger: Split).
 *  Keeping both makes a second part with a new identity. */
import type { MirrorPlaneReference } from "@aether/core/document";
import { availableBodies } from "@aether/core/document";
import { mountPartBox } from "./part-box";
import { mountPlaneBox } from "./plane-box";
import { checkRow, iconButton, planned, rowIn, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const toolsGap = "Not available in this kernel: the splitting entity is never consumed here, so Keep tools has nothing to decide (recorded gap for surface tools).";
const trimGap = "Not available in this kernel: a split limited to a face's boundary is a recorded gap (the plane extends).";

export const splitEditor: FeatureEditor = {
  type: "split",
  controls(context: FeatureEditorContext): Controls {
    const { field, feature, doc } = context;
    return {
      bodies: field("Part to split identity", JSON.stringify(feature?.bodyIds ?? [])),
      planeRef: field("Split plane reference", feature?.plane ? JSON.stringify(feature.plane) : ""),
      keepBoth: field("Keep both sides", String((feature?.keep ?? "both") === "both"), ["false", "true"]),
      keep: field("Keep", feature?.keep ?? "both", ["both", "positive", "negative"]),
      copy: field("Second piece ID", feature?.copyBodyIds?.[feature.bodyIds[0]] ?? `${doc.documentId}:split-${crypto.randomUUID()}`),
    };
  },
  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, feature, doc } = context;
    for (const key of ["copy", "keep"] as const) { controls[key].closest("label")?.remove(); controls[key].hidden = true; controls[key].setAttribute("form", form.id); form.append(controls[key]); }
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const parts = mountPartBox(context, controls.bodies, "Parts to split", availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined }), () => "", { single: true });
    win.body.append(parts.element);
    mountPlaneBox(context, controls.planeRef, "Entity to split with", { sketchLines: true });
    const check = (label: string, reason: string, checked = false) => { const box = document.createElement("input"); box.type = "checkbox"; box.checked = checked; box.setAttribute("aria-label", label); win.body.append(planned(rowIn(label, box), reason)); };
    check("Keep tools", toolsGap, true); check("Trim to face boundaries", trimGap);
    const keepBoth = checkRow(context, controls.keepBoth, "Keep both sides", () => { controls.keep.value = controls.keepBoth.value === "true" ? "both" : controls.keep.value === "both" ? "positive" : controls.keep.value; sync(); });
    // Opposite direction: which side is kept when only one is.
    const flip = iconButton("flip-horizontal", "Opposite direction");
    flip.onclick = () => { controls.keep.value = controls.keep.value === "negative" ? "positive" : "negative"; sync(); controls.keep.dispatchEvent(new Event("change")); };
    (keepBoth.querySelector(".aui-feature-row-control") ?? keepBoth).append(flip);
    const sync = () => { flip.hidden = controls.keepBoth.value === "true"; flip.setAttribute("aria-pressed", String(controls.keep.value === "negative")); };
    sync();
  },
  validate(controls) {
    if (JSON.parse(controls.bodies.value).length !== 1) return "Select one part to split.";
    if (!controls.planeRef.value) return "Select the entity to split with: a plane, a planar face or a straight sketch line.";
    return null;
  },
  serialize(values) {
    const plane = JSON.parse(values.planeRef) as MirrorPlaneReference;
    if (plane.kind === "face") delete (plane as { centerMillimeters?: unknown }).centerMillimeters;
    const bodyIds = JSON.parse(values.bodies) as [string], keep = values.keepBoth === "true" ? "both" : values.keep === "both" ? "positive" : values.keep;
    return { bodyIds, plane, keep, ...(keep === "both" ? { copyBodyIds: { [bodyIds[0]]: values.copy } } : {}) };
  },
};
