import { availableBodies } from "@aether/core/document";
import { parsePoints3D } from "./curve3d";
import type { FeatureEditor } from "./shared";

/** Boundary Fill: tool bodies cut space into cells; a point inside each picked cell fills it. */
export const boundaryFillEditor: FeatureEditor = {
  type: "boundary-fill",
  handles: false,
  controls({ field, feature }) {
    return {
      operation: field("Operation", feature?.operation ?? "new", ["new", "add", "cut", "intersect"]),
      tools: field("Tool body IDs", JSON.stringify(feature?.toolBodyIds ?? [])),
      cells: field("Cell points (x y z; …) mm", feature ? feature.cellPointsMillimeters.map((p: number[]) => p.join(" ")).join("; ") : ""),
      remove: field("Remove tools", feature?.removeTools ? "yes" : "no", ["no", "yes"]),
    };
  },
  layout({ doc, feature, form, win }, controls) {
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    controls.tools.closest("label")?.remove(); controls.tools.hidden = true; controls.tools.setAttribute("form", form.id); form.append(controls.tools);
    const box = win.entitiesBox("Tool bodies"), list = document.createElement("div"); box.element.append(list); win.body.prepend(box.element);
    const selected = (): string[] => JSON.parse(controls.tools.value);
    for (const body of bodies) {
      const label = document.createElement("label"); label.className = "aui-feature-entity";
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = selected().includes(body.id); input.setAttribute("aria-label", `Use ${body.name} as a boundary`);
      input.onchange = () => { controls.tools.value = JSON.stringify(input.checked ? [...selected(), body.id] : selected().filter((id) => id !== body.id)); controls.tools.dispatchEvent(new Event("change")); };
      label.append(input, document.createTextNode(body.name)); list.append(label);
    }
  },
  validate(controls) {
    if (!(JSON.parse(controls.tools.value) as string[]).length) return "Choose the tool bodies that bound the cells.";
    try { if (!parsePoints3D(controls.cells.value).length) return "Enter a point inside each cell to fill."; } catch (error) { return (error as Error).message; }
    return null;
  },
  serialize(values) {
    return { operation: values.operation, toolBodyIds: JSON.parse(values.tools), cellPointsMillimeters: parsePoints3D(values.cells), ...(values.remove === "yes" ? { removeTools: true } : {}) };
  },
};
