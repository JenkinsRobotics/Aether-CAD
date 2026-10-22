import { availableBodies } from "@aether/core/document";
import type { FeatureEditor, FeatureEditorContext } from "./shared";

/** Bounding Solid: the box around every part (or the chosen parts), grown by a margin, as a new part. */
export const boundingSolidEditor: FeatureEditor = {
  type: "bounding-solid",
  controls({ field, feature, doc }: FeatureEditorContext) {
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const choices = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const pick = field("Part", choices[0]?.id ?? "", choices.map((b) => b.id));
    Array.from(pick.children).forEach((o, i) => (o.textContent = choices[i].name));
    return { margin: field("Margin (mm)", String(feature?.marginMillimeters ?? 0)), scope: field("Parts", feature?.bodyIds ? "chosen" : "all", ["all", "chosen"]), bodies: field("Chosen parts", JSON.stringify(feature?.bodyIds ?? [])), pick };
  },
  layout({ win, form }, controls) {
    controls.bodies.closest("label")?.remove(); controls.bodies.hidden = true; controls.bodies.setAttribute("form", form.id); form.append(controls.bodies);
    const box = win.entitiesBox("Parts to bound"); win.body.prepend(box.element);
    const names = new Map(Array.from(controls.pick.children).map((o) => [(o as HTMLOptionElement).value, o.textContent ?? ""]));
    const read = (): string[] => JSON.parse(controls.bodies.value);
    const update = (ids: string[]) => { controls.bodies.value = JSON.stringify(ids); if (ids.length) controls.scope.value = "chosen"; render(); controls.bodies.dispatchEvent(new Event("change")); };
    const render = () => box.render(read().map((id) => ({ label: names.get(id) ?? id, onRemove: () => update(read().filter((other) => other !== id)) })));
    const add = document.createElement("button"); add.type = "button"; add.className = "aui-button"; add.textContent = "Add part"; add.onclick = () => { const id = controls.pick.value; if (id && !read().includes(id)) update([...read(), id]); }; box.element.append(add);
    const pickRow = controls.pick.closest<HTMLElement>(".aui-feature-row") ?? controls.pick.parentElement;
    const sync = () => { box.element.hidden = controls.scope.value !== "chosen"; if (pickRow) pickRow.hidden = controls.scope.value !== "chosen"; };
    controls.scope.addEventListener("change", sync); sync(); render();
  },
  validate(controls) {
    if (!(Number(controls.margin.value) >= 0)) return "Margin must be zero or positive.";
    if (controls.scope.value === "chosen" && !JSON.parse(controls.bodies.value).length) return "Choose at least one part, or bound all parts.";
    return null;
  },
  serialize(values) { return { marginMillimeters: Number(values.margin), operation: "new", ...(values.scope === "chosen" ? { bodyIds: JSON.parse(values.bodies) } : {}) }; },
};
