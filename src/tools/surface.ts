/** Surface — Fusion's SURFACE tab. Open, zero-thickness geometry.
 *
 *  Sheets are shells in the same body list as solids (`aether-engine/src/document/surface.ts`).
 *  Trim stays greyed: trimming needs shell-against-solid booleans the kernel build
 *  does not perform.
 */
import { surfaceProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const surfaceWorkspace: CADRibbonWorkspaceDefinition = {
  id: "surface",
  label: "Surface",
  groups: [
    { id: "surface-create", label: "Create", tools: [
      tool("surface-extrude", "Extrude", "extrude", "feature-surface-extrude"),
      tool("surface-revolve", "Revolve", "revolve", "feature-surface-revolve"),
      tool("surface-sweep", "Sweep", "sweep", "feature-surface-sweep"),
      tool("surface-loft", "Loft", "loft", "feature-surface-loft"),
      tool("surface-patch", "Patch", "face", "feature-surface-patch"),
      tool("surface-offset", "Offset", "offset", "feature-surface-offset"),
      tool("surface-ruled", "Ruled", "curve", "feature-surface-ruled"),
    ] },
    { id: "surface-modify", label: "Modify", tools: [
      tool("surface-trim", "Trim", "trim", undefined, surfaceProducer),
      tool("surface-extend", "Extend", "push-pull", "feature-surface-extend"),
      tool("surface-stitch", "Stitch", "weld", "feature-surface-stitch"),
      tool("surface-unstitch", "Unstitch", "split", "feature-surface-unstitch"),
      tool("surface-reverse-normal", "Reverse Normal", "normal", "feature-surface-reverse-normal"),
      tool("surface-thicken", "Thicken", "thicken", "feature-surface-thicken"),
    ] },
  ],
};
