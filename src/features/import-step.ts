import type { FeatureEditor } from "./shared";

/** Imported source is immutable; history rename/suppress/delete remain available. */
export const importSTEPEditor: FeatureEditor = {
  type: "import-step",
  controls(context) {
    const source = context.field("Source STEP", context.feature?.sourceName ?? "");
    source.setAttribute("readonly", "");
    const operation = context.field("Operation", "new");
    return { source, operation };
  },
  layout(context, controls) {
    controls.operation.closest("label")?.remove();
    controls.operation.hidden = true;
    const note = document.createElement("p");
    note.textContent = "The original STEP source is saved in this feature. Add sketches and solid features to modify its geometry.";
    note.style.fontSize = "0.8rem";
    context.win.body.append(note);
  },
  serialize(_values, context) {
    return { operation: "new", bodyId: context.feature.bodyId, sourceName: context.feature.sourceName, dataBase64: context.feature.dataBase64 };
  },
};
