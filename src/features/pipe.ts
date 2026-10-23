import { bodyAndOperationTabs, entityChips, requireSelections, type FeatureEditor, type FeatureEditorContext } from "./shared";

const operationValues = ["new", "add", "cut"] as const;

/** Pipe: a round section swept along a sketch curve, solid or with a wall. */
export const pipeEditor: FeatureEditor = {
  type: "pipe",
  controls({ field, reference, feature, doc }: FeatureEditorContext) {
    return {
      path: reference("Pipe path", ["sketch", "profile", "curve3d"], feature?.pathFeatureId),
      diameter: field("Diameter (mm)", String(feature?.diameterMillimeters ?? 10)),
      wall: field("Wall (mm, blank = solid)", feature?.wallMillimeters === undefined ? "" : String(feature.wallMillimeters)),
      operation: field("Operation", feature?.operation ?? (doc.features.some((f) => ["extrude", "revolve", "sweep", "pipe"].includes(f.type)) ? "add" : "new"), [...operationValues]),
    };
  },
  layout({ win, form }, controls) {
    bodyAndOperationTabs(win, form, controls.operation, operationValues);
    entityChips(win, "Pipe path", controls.path, form);
  },
  validate(controls) {
    const d = Number(controls.diameter.value), w = controls.wall.value.trim() ? Number(controls.wall.value) : undefined;
    if (!(d > 0)) return "Enter a positive diameter.";
    if (w !== undefined && !(w > 0 && w < d / 2)) return "Wall must be positive and less than the radius.";
    return requireSelections(controls, [{ key: "path", noun: "a path sketch" }]);
  },
  serialize(values) {
    return { pathFeatureId: values.path, diameterMillimeters: Number(values.diameter), ...(values.wall?.trim() ? { wallMillimeters: Number(values.wall) } : {}), operation: values.operation };
  },
};
