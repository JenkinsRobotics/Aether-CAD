/** Mirror, as Onshape's (help: PartStudio/mirror.htm): Part / Feature / Face mirror type, the
 *  New / Add / Remove / Intersect result, Entities to mirror (parts from the viewport, or the
 *  feature), one Mirror plane box (a tree plane, a Plane feature or a picked planar face), Reapply
 *  features and the Merge scope. A part mirror's New images take new identities; Add, Remove and
 *  Intersect meet the merge scope part. Face mirroring and Reapply features are present and
 *  disabled with the gap named (ledger: Mirror). */
import type { MirrorPlaneReference } from "@aether/core/document";
import { availableBodies } from "@aether/core/document";
import { mountPlaneBox } from "./plane-box";
import { mountPartBox } from "./part-box";
import { entityChips, planned, requireSelections, rowIn, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const faceGap = "Not available in this kernel: mirroring faces of a part is a recorded gap (mirror the feature or the part).";
const reapplyGap = "Not available in this kernel: regenerating the seed features' references per instance is a recorded gap.";

export const mirrorEditor: FeatureEditor = {
  type: "mirror",

  controls({ field, reference, feature, doc }: FeatureEditorContext): Controls {
    const saved: MirrorPlaneReference | null = feature?.mirrorPlane ?? (feature ? { kind: "principal", plane: feature.plane, offsetMillimeters: feature.offsetMillimeters } : null);
    return {
      what: field("Mirror", feature?.bodyIds ? "parts" : "feature", ["parts", "feature"]),
      parts: field("Parts to mirror", JSON.stringify(feature?.bodyIds ?? [])),
      copyPrefix: field("Copy ID prefix", feature?.copyBodyIds ? String(Object.values(feature.copyBodyIds)[0] ?? "").replace(/-\d+$/, "") : `${doc.documentId}:mirror-${crypto.randomUUID()}`),
      source: reference("Feature", ["extrude", "revolve", "mirror"], feature?.sourceFeatureId),
      planeRef: field("Mirror plane reference", saved ? JSON.stringify(saved) : ""),
      operation: field("Operation", feature?.operation ?? "add", ["new", "add", "cut", "intersect"]),
      mergeScope: field("Merge scope part", JSON.stringify(feature?.targetBodyId ? [feature.targetBodyId] : (availableBodies(doc).at(-1) ? [availableBodies(doc).at(-1)!.id] : []))),
    };
  },

  layout(context: FeatureEditorContext, controls: Controls) {
    const { win, form, doc, feature } = context;
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    for (const key of ["what", "parts", "copyPrefix", "operation"]) hide(controls[key]);
    const types = win.tabs(["Part", "Feature", "Face"], controls.what.value === "parts" ? 0 : 1);
    [...types.children].forEach((tab, index) => {
      if (index === 2) { planned(tab as HTMLButtonElement, faceGap); return; }
      (tab as HTMLButtonElement).onclick = () => { controls.what.value = index === 0 ? "parts" : "feature"; [...types.children].forEach((other, i) => other.classList.toggle("active", i === index)); sync(); controls.what.dispatchEvent(new Event("change")); };
    });
    const values = ["new", "add", "cut", "intersect"];
    const results = win.tabs(["New", "Add", "Remove", "Intersect"], Math.max(0, values.indexOf(controls.operation.value)));
    [...results.children].forEach((tab, index) => {
      (tab as HTMLButtonElement).onclick = () => { controls.operation.value = values[index]; [...results.children].forEach((other, i) => other.classList.toggle("active", i === index)); sync(); controls.operation.dispatchEvent(new Event("change")); };
    });
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const parts = mountPartBox(context, controls.parts, "Entities to mirror", bodies);
    win.body.append(parts.element);
    const chips = entityChips(win, "Entities to mirror", controls.source, form);
    mountPlaneBox(context, controls.planeRef, "Mirror plane");
    const reapply = document.createElement("input"); reapply.type = "checkbox"; reapply.setAttribute("aria-label", "Reapply features");
    win.body.append(planned(rowIn("Reapply features", reapply), reapplyGap));
    const scope = mountPartBox(context, controls.mergeScope, "Merge scope", bodies, () => "", { single: true });
    win.body.append(scope.element);
    controls.mergeScope.addEventListener("change", () => { const id = JSON.parse(controls.mergeScope.value || "[]")[0]; if (id) { controls.target.value = id; controls.target.dispatchEvent(new Event("change")); } });
    const sync = () => {
      const isParts = controls.what.value === "parts";
      parts.element.hidden = !isParts; chips.element.hidden = isParts;
      scope.element.hidden = controls.operation.value === "new";
    };
    sync();
    // The part box takes picks; the feature mirror's list needs none.
    if (controls.what.value === "parts") parts.element.dispatchEvent(new Event("pointerdown"));
  },

  validate(controls) {
    if (!controls.planeRef.value) return "Select the mirror plane: a plane in the tree or a planar face.";
    if (controls.operation.value !== "new" && !JSON.parse(controls.mergeScope.value || "[]").length) return "Select the merge scope part.";
    if (controls.what.value === "parts") return JSON.parse(controls.parts.value || "[]").length ? null : "Select the parts to mirror.";
    return requireSelections(controls, [{ key: "source", noun: "a feature to mirror" }]);
  },

  serialize(values) {
    const ref = JSON.parse(values.planeRef) as MirrorPlaneReference;
    if (ref.kind === "face") delete (ref as { centerMillimeters?: unknown }).centerMillimeters;
    const parts = values.what === "parts" ? (JSON.parse(values.parts || "[]") as string[]) : undefined;
    return {
      ...(parts ? { bodyIds: parts, ...(values.operation === "new" ? { copyBodyIds: Object.fromEntries(parts.map((id, i) => [id, `${values.copyPrefix}-${i + 1}`])) } : {}) } : { sourceFeatureId: values.source }),
      plane: ref.kind === "principal" ? ref.plane : "XY",
      offsetMillimeters: ref.kind === "principal" ? ref.offsetMillimeters : 0,
      ...(ref.kind === "principal" ? {} : { mirrorPlane: ref }),
      operation: values.operation,
      ...(values.operation !== "new" ? { targetBodyId: JSON.parse(values.mergeScope || "[]")[0] } : {}),
    };
  },
};
