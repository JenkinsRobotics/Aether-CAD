import { availableBodies } from "@aether/core/document";
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
  layout({ win, form }, controls) {
    controls.bodies.closest("label")?.remove(); controls.bodies.hidden = true; controls.bodies.setAttribute("form", form.id); form.append(controls.bodies);
    const box = win.entitiesBox("Parts to remove"); win.body.prepend(box.element);
    const names = new Map(Array.from(controls.pick.children).map((o) => [(o as HTMLOptionElement).value, o.textContent ?? ""]));
    const read = (): string[] => JSON.parse(controls.bodies.value);
    const update = (ids: string[]) => { controls.bodies.value = JSON.stringify(ids); render(); controls.bodies.dispatchEvent(new Event("change")); };
    const render = () => box.render(read().map((id) => ({ label: names.get(id) ?? id, onRemove: () => update(read().filter((other) => other !== id)) })));
    const add = document.createElement("button"); add.type = "button"; add.className = "aui-button"; add.textContent = "Add part"; add.onclick = () => { const id = controls.pick.value; if (id && !read().includes(id)) update([...read(), id]); }; box.element.append(add);
    render();
  },
  validate(controls) { return JSON.parse(controls.bodies.value).length ? null : "Choose at least one part to remove."; },
  serialize(values) { return { bodyIds: JSON.parse(values.bodies) }; },
};
