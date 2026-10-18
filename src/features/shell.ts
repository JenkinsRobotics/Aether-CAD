import {
  type Controls,
  type FeatureEditor,
  type FeatureEditorContext,
} from "./shared";

export const shellEditor: FeatureEditor = {
  type: "shell",

  controls({ field, feature }: FeatureEditorContext): Controls {
    return {
      thickness: field("Thickness (mm)", String(feature?.thicknessMillimeters ?? 1)),
      removeScope: field("Faces to remove", feature?.removedFaces ? "plane" : "none", ["none", "plane"]),
      removePlane: field("Removed face plane", feature?.removedFaces?.[0]?.plane ?? "XY", ["XY", "XZ", "YZ"]),
      removeOffset: field(
        "Removed plane offset (mm)",
        String(feature?.removedFaces?.[0]?.offsetMillimeters ?? 0),
      ),
    };
  },

  serialize(values) {
    return {
      thicknessMillimeters: Number(values.thickness),
      ...(values.removeScope === "plane"
        ? {
            removedFaces: [
              {
                plane: values.removePlane,
                offsetMillimeters: Number(values.removeOffset),
              },
            ],
          }
        : {}),
    };
  },
};
