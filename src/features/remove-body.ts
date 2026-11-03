import { availableBodies } from "@aether/core/document";
import { mountPartBox } from "./part-box";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Remove: chosen parts leave the history from this feature on. */
export const removeBodyEditor: FeatureEditor = {
  type: "remove-body",
  controls({ field, feature, doc }: FeatureEditorContext) {
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const choices = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const bodies = field("Parts to remove", JSON.stringify(feature?.bodyIds ?? []));
    const pick = field("Part", choices[0]?.id ?? "", choices.map((b) => b.id));
    Array.from(pick.children).forEach((o, i) => (o.textContent = choices[i].name));
    return { bodies, pick };
  },
  layout(context, controls) {
    const { form } = context;
    controls.pick.closest("label")?.remove(); controls.pick.hidden = true; controls.pick.setAttribute("form", form.id); form.append(controls.pick);
    mountPartBox(context, controls.bodies, "Parts to remove", Array.from(controls.pick.children).map((o) => ({ id: (o as HTMLOptionElement).value, name: o.textContent ?? "" })));
  },
  validate(controls) { return JSON.parse(controls.bodies.value).length ? null : "Choose at least one part to remove."; },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies) }; },
};
