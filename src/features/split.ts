/** Split, as Onshape's (help: PartStudio/split.htm): the Part / Face switch (the window's first
 *  row, which opens the Face split feature), Parts to split, Entity to split with (a tree plane, a
 *  Plane feature, a picked face of a part or surface, or a straight sketch line), Keep tools, Trim
 *  to face boundaries, Keep both sides and the Opposite direction arrow. A planar face or plane
 *  splits through its plane; a curved face by its whole surface, or within its boundary with Trim
 *  to face boundaries (which keeps both sides). Keeping both makes a second part with a new
 *  identity; Keep tools off consumes a surface body whose face was the tool. */
import type { MirrorPlaneReference, SolidFaceReference } from "@aether/core/document";
import { availableBodies } from "@aether/core/document";
import { mountPartBox } from "./part-box";
import { mountPlaneBox } from "./plane-box";
import { checkRow, iconButton, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

export const splitEditor: FeatureEditor = {
  type: "split",
  controls(context: FeatureEditorContext): Controls {
    const { field, feature, doc } = context;
    return {
      bodies: field("Part to split identity", JSON.stringify(feature?.bodyIds ?? [])),
      planeRef: field("Split plane reference", feature?.plane ? JSON.stringify(feature.plane) : feature?.tool ? JSON.stringify(feature.tool) : ""),
      keepTools: field("Keep tools", String(feature ? feature.keepTools !== false : false), ["false", "true"]),
      trim: field("Trim to face boundaries", String(Boolean(feature?.trimToFace)), ["false", "true"]),
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
    mountPlaneBox(context, controls.planeRef, "Entity to split with", { sketchLines: true, anyFace: true });
    checkRow(context, controls.keepTools, "Keep tools");
    const trim = checkRow(context, controls.trim, "Trim to face boundaries", () => { if (controls.trim.value === "true") { controls.keepBoth.value = "true"; controls.keep.value = "both"; (keepBoth.querySelector("input") as HTMLInputElement).checked = true; } sync(); });
    const keepBoth = checkRow(context, controls.keepBoth, "Keep both sides", () => { controls.keep.value = controls.keepBoth.value === "true" ? "both" : controls.keep.value === "both" ? "positive" : controls.keep.value; sync(); });
    // Opposite direction: which side is kept when only one is.
    const flip = iconButton("flip-horizontal", "Opposite direction");
    flip.onclick = () => { controls.keep.value = controls.keep.value === "negative" ? "positive" : "negative"; sync(); controls.keep.dispatchEvent(new Event("change")); };
    (keepBoth.querySelector(".aui-feature-row-control") ?? keepBoth).append(flip);
    const sync = () => {
      const ref = controls.planeRef.value ? JSON.parse(controls.planeRef.value) : null, face = ref?.kind === "face";
      trim.hidden = !face; (keepBoth.querySelector("input") as HTMLInputElement).disabled = face && controls.trim.value === "true";
      flip.hidden = controls.keepBoth.value === "true"; flip.setAttribute("aria-pressed", String(controls.keep.value === "negative"));
    };
    controls.planeRef.addEventListener("change", sync);
    sync();
  },
  validate(controls) {
    if (JSON.parse(controls.bodies.value).length !== 1) return "Select one part to split.";
    if (!controls.planeRef.value) return "Select the entity to split with: a plane, a face or a straight sketch line.";
    const ref = JSON.parse(controls.planeRef.value) as MirrorPlaneReference;
    if (ref.kind === "face" && ref.surfaceType && controls.trim.value !== "true" && !["cylinder", "cone", "sphere", "torus"].includes(ref.surfaceType)) return "A free-form face splits only within its boundary: check Trim to face boundaries.";
    return null;
  },
  serialize(values) {
    const ref = JSON.parse(values.planeRef) as MirrorPlaneReference;
    if (ref.kind === "face") delete (ref as { centerMillimeters?: unknown }).centerMillimeters;
    const bodyIds = JSON.parse(values.bodies) as [string];
    const trimmed = ref.kind === "face" && values.trim === "true", keep = trimmed || values.keepBoth === "true" ? "both" : values.keep === "both" ? "positive" : values.keep;
    const entity = ref.kind === "face" && (trimmed || (ref as SolidFaceReference).surfaceType) ? { tool: ref as { kind: "face" } & SolidFaceReference, ...(trimmed ? { trimToFace: true } : {}) } : { plane: ref };
    return { bodyIds, ...entity, keep, keepTools: values.keepTools === "true", ...(keep === "both" ? { copyBodyIds: { [bodyIds[0]]: values.copy } } : {}) };
  },
};
