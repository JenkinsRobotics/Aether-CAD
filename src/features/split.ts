/** Split, as Onshape's Part split: the part to split, one Entity to split with box (a tree
 *  plane, a Plane feature, a planar face or a straight sketch line) and Keep both sides.
 *  Keeping both makes a second part with a new identity. */
import type { MirrorPlaneReference } from "@aether/core/document";
import { availableBodies } from "@aether/core/document";
import { mountPartBox } from "./part-box";
import { mountPlaneBox } from "./plane-box";
import { checkRow, type FeatureEditor } from "./shared";

export const splitEditor: FeatureEditor = {
  type: "split",
  controls(context) {
    const { field, feature, doc } = context;
    return {
      bodies: field("Part to split identity", JSON.stringify(feature?.bodyIds ?? [])),
      planeRef: field("Split plane reference", feature?.plane ? JSON.stringify(feature.plane) : ""),
      keepBoth: field("Keep both sides", String((feature?.keep ?? "both") === "both"), ["false", "true"]),
      keep: field("Keep", feature?.keep ?? "both", ["both", "positive", "negative"]),
      copy: field("Second piece ID", feature?.copyBodyIds?.[feature.bodyIds[0]] ?? `${doc.documentId}:split-${crypto.randomUUID()}`),
    };
  },
  layout(context, controls) {
    const { form, feature, doc } = context;
    for (const key of ["copy", "keep"] as const) { controls[key].closest("label")?.remove(); controls[key].hidden = true; controls[key].setAttribute("form", form.id); form.append(controls[key]); }
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    mountPartBox(context, controls.bodies, "Part to split", availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined }), () => "", { single: true });
    mountPlaneBox(context, controls.planeRef, "Entity to split with", { sketchLines: true });
    checkRow(context, controls.keepBoth, "Keep both sides", () => { controls.keep.value = controls.keepBoth.value === "true" ? "both" : controls.keep.value === "both" ? "positive" : controls.keep.value; });
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
