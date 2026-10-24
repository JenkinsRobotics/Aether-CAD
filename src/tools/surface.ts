/** Surface — Fusion's SURFACE tab. Open, zero-thickness geometry.
 *
 *  Sheets are shells in the same body list as solids (`aether-engine/src/document/surface.ts`).
 *  Trim cuts at a plane with the general fuse (r63); trimming by another surface or curves
 *  is not built yet. Earlier note: trimming needed shell-against-solid booleans the kernel build
 *  does not perform.
 */
import { tool, type CADRibbonWorkspaceDefinition } from "./shared";

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
      tool("surface-boundary", "Boundary", "face", "feature-surface-boundary"),
      tool("surface-blend", "Blend", "loft", "feature-surface-blend"),
    ] },
    { id: "surface-modify", label: "Modify", tools: [
      tool("surface-trim", "Trim", "trim", "feature-surface-trim"),
      tool("surface-extend", "Extend", "push-pull", "feature-surface-extend"),
      tool("surface-stitch", "Stitch", "weld", "feature-surface-stitch"),
      tool("surface-unstitch", "Unstitch", "split", "feature-surface-unstitch"),
      tool("surface-reverse-normal", "Reverse Normal", "normal", "feature-surface-reverse-normal"),
      tool("surface-untrim", "Untrim", "face", "feature-surface-untrim"),
      tool("surface-thicken", "Thicken", "thicken", "feature-surface-thicken"),
    ] },
  ],
};
