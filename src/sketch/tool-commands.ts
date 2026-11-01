import { sketchVariantTools } from "@aether/core/sketch";
import type { CADCommandRegistry } from "../cad-command-registry";
import { contextualDrawingTools } from "./tangent-arc-tool";
import { directModificationTools, modificationTools } from "./tool-instructions";

/** One catalog drives registration and availability, including projection tools. */
const tools = [
  "select", "line", "arc", "circle", "rectangle",
  "intersect", "include-edges", "fit-section", "spun-profile",
  "control-spline",
  ...sketchVariantTools, ...contextualDrawingTools,
  ...modificationTools, ...directModificationTools,
] as const;

export function registerSketchToolCommands(
  registry: CADCommandRegistry,
  run: (tool: typeof tools[number]) => void,
) {
  const releases = tools.map(tool => {
    const id = `sketch-${tool}` as const;
    registry.setEnabled(id, false);
    return registry.register(id, () => run(tool));
  });
  return {
    setEditing(active: boolean) {
      for (const tool of tools) registry.setEnabled(`sketch-${tool}`, active);
    },
    dispose() {
      for (const release of releases) release();
    },
  };
}
