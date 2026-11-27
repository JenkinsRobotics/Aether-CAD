/** Enclose (Boundary Fill), as Onshape's (help: PartStudio/enclose.htm): New / Add / Remove /
 *  Intersect, Entities (the parts and surfaces that bound the region), Keep tools and the Merge
 *  scope. This kernel fills the cells the tools cut space into, one picked point per cell; Onshape
 *  finds the enclosed region itself, which is a recorded gap, so the Cell points row stays. */
import { availableBodies } from "@aether/core/document";
import { parsePoints3D } from "./curve3d";
import { mountPartBox } from "./part-box";
import { checkRow, operationTabs, rowIn, type FeatureEditor } from "./shared";

export const boundaryFillEditor: FeatureEditor = {
  type: "boundary-fill",
  handles: false,
  controls({ field, feature, doc }) {
    return {
      operation: field("Operation", feature?.operation ?? "new", ["new", "add", "cut", "intersect"]),
      tools: field("Tool body IDs", JSON.stringify(feature?.toolBodyIds ?? [])),
      cells: field("Cell points (x y z; …) mm", feature ? feature.cellPointsMillimeters.map((p: number[]) => p.join(" ")).join("; ") : ""),
      keep: field("Keep tools", feature ? (feature.removeTools ? "false" : "true") : "false", ["false", "true"]),
      mergeScope: field("Merge scope part", JSON.stringify(feature?.targetBodyId ? [feature.targetBodyId] : availableBodies(doc).at(-1) ? [availableBodies(doc).at(-1)!.id] : [])),
    };
  },
  layout(context, controls) {
    const { doc, feature, form, win } = context;
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    operationTabs(win, form, controls.operation, ["new", "add", "cut", "intersect"], ["New", "Add", "Remove", "Intersect"]);
    const entities = mountPartBox(context, controls.tools, "Entities", bodies);
    win.body.append(entities.element);
    controls.cells.closest("label")?.remove(); controls.cells.setAttribute("form", form.id);
    win.body.append(rowIn("Cell points (x y z; …)", controls.cells));
    const note = document.createElement("p"); note.textContent = "A point inside each enclosed region to fill, in document millimetres. Onshape finds the enclosed region itself: a recorded gap."; win.addHelp(note);
    checkRow(context, controls.keep, "Keep tools");
    const scope = mountPartBox(context, controls.mergeScope, "Merge scope", bodies, () => "", { single: true });
    win.body.append(scope.element);
    controls.mergeScope.addEventListener("change", () => { const id = JSON.parse(controls.mergeScope.value || "[]")[0]; if (id) { controls.target.value = id; controls.target.dispatchEvent(new Event("change")); } });
    const sync = () => { scope.element.hidden = controls.operation.value === "new"; };
    controls.operation.addEventListener("change", sync); sync();
    entities.element.dispatchEvent(new Event("pointerdown"));
  },
  validate(controls) {
    if (!(JSON.parse(controls.tools.value) as string[]).length) return "Select the parts and surfaces that enclose the region.";
    try { if (!parsePoints3D(controls.cells.value).length) return "Enter a point inside each enclosed region to fill."; } catch (error) { return (error as Error).message; }
    if (controls.operation.value !== "new" && !JSON.parse(controls.mergeScope.value || "[]").length) return "Select the merge scope part.";
    return null;
  },
  serialize(values) {
    return { operation: values.operation, toolBodyIds: JSON.parse(values.tools), cellPointsMillimeters: parsePoints3D(values.cells), ...(values.keep === "true" ? {} : { removeTools: true }), ...(values.operation !== "new" ? { targetBodyId: JSON.parse(values.mergeScope || "[]")[0] } : {}) };
  },
};
