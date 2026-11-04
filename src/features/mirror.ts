/** Mirror, as Onshape's (help: PartStudio/mirror.htm): Part / Feature / Face mirror type, the
 *  New / Add / Remove / Intersect result, Entities to mirror, one Mirror plane box (a tree plane,
 *  a Plane feature or a picked planar face), Reapply features and the Merge scope. This kernel
 *  mirrors features (Add and Remove) into one part: Part and Face mirroring, New and Intersect
 *  and Reapply features are present and disabled with the gap named (ledger: Mirror). Whole
 *  parts mirror with Transform › Mirror. */
import type { MirrorPlaneReference } from "@aether/core/document";
import { availableBodies } from "@aether/core/document";
import { mountPlaneBox } from "./plane-box";
import { mountPartBox } from "./part-box";
import { entityChips, planned, requireSelections, rowIn, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const typeGap = "Not available in this kernel: mirroring parts or faces here is a recorded gap (parts mirror with Transform › Mirror).";
const resultGap = "Not available in this kernel: a mirror that makes a new part or intersects is a recorded gap.";
const reapplyGap = "Not available in this kernel: regenerating the seed features' references per instance is a recorded gap.";

export const mirrorEditor: FeatureEditor = {
  type: "mirror",

  controls({ field, reference, feature, doc }: FeatureEditorContext): Controls {
    const saved: MirrorPlaneReference | null = feature?.mirrorPlane ?? (feature ? { kind: "principal", plane: feature.plane, offsetMillimeters: feature.offsetMillimeters } : null);
    return {
      source: reference("Feature", ["extrude", "revolve", "mirror"], feature?.sourceFeatureId),
      planeRef: field("Mirror plane reference", saved ? JSON.stringify(saved) : ""),
      operation: field("Operation", feature?.operation ?? "add", ["add", "cut"]),
      mergeScope: field("Merge scope part", JSON.stringify(feature?.targetBodyId ? [feature.targetBodyId] : (availableBodies(doc).at(-1) ? [availableBodies(doc).at(-1)!.id] : []))),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, doc, feature } = context;
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    const types = win.tabs(["Part", "Feature", "Face"], 1);
    [...types.children].forEach((tab, index) => { if (index !== 1) planned(tab as HTMLButtonElement, typeGap); });
    hide(controls.operation);
    const results = win.tabs(["New", "Add", "Remove", "Intersect"], controls.operation.value === "cut" ? 2 : 1);
    const values = [null, "add", "cut", null];
    [...results.children].forEach((tab, index) => {
      const value = values[index];
      if (!value) { planned(tab as HTMLButtonElement, resultGap); return; }
      (tab as HTMLButtonElement).onclick = () => { controls.operation.value = value; [...results.children].forEach((other, i) => other.classList.toggle("active", i === index)); controls.operation.dispatchEvent(new Event("change")); };
    });
    entityChips(win, "Entities to mirror", controls.source, form);
    mountPlaneBox(context, controls.planeRef, "Mirror plane");
    const reapply = document.createElement("input"); reapply.type = "checkbox"; reapply.setAttribute("aria-label", "Reapply features");
    win.body.append(planned(rowIn("Reapply features", reapply), reapplyGap));
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const scope = mountPartBox(context, controls.mergeScope, "Merge scope", bodies, () => "", { single: true });
    win.body.append(scope.element);
    controls.mergeScope.addEventListener("change", () => { const id = JSON.parse(controls.mergeScope.value || "[]")[0]; if (id) { controls.target.value = id; controls.target.dispatchEvent(new Event("change")); } });
  },

  validate(controls) {
    if (!controls.planeRef.value) return "Select the mirror plane: a plane in the tree or a planar face.";
    if (!JSON.parse(controls.mergeScope.value || "[]").length) return "Select the merge scope part.";
    return requireSelections(controls, [{ key: "source", noun: "a feature to mirror" }]);
  },

  serialize(values) {
    const ref = JSON.parse(values.planeRef) as MirrorPlaneReference;
    if (ref.kind === "face") delete (ref as { centerMillimeters?: unknown }).centerMillimeters;
    return {
      sourceFeatureId: values.source,
      plane: ref.kind === "principal" ? ref.plane : "XY",
      offsetMillimeters: ref.kind === "principal" ? ref.offsetMillimeters : 0,
      ...(ref.kind === "principal" ? {} : { mirrorPlane: ref }),
      operation: values.operation,
      targetBodyId: JSON.parse(values.mergeScope || "[]")[0],
    };
  },
};
