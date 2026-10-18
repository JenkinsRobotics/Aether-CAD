/** Surface — Fusion's SURFACE tab. Open, zero-thickness geometry.
 *
 *  None of it is wired: FreeCAD has a Surface workbench, but `freecad-translate`
 *  emits no surface features and `worker.py` builds none, so every tool here is
 *  greyed and says so. The tab exists because the taxonomy is the taxonomy —
 *  a Design workspace has a Surface tab — not because it works.
 */
import { surfaceProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const surfaceWorkspace: CADRibbonWorkspaceDefinition = {
  id: "surface",
  label: "Surface",
  groups: [
    { id: "surface-create", label: "Create", tools: [
      tool("surface-extrude", "Extrude", "extrude", undefined, surfaceProducer),
      tool("surface-revolve", "Revolve", "revolve", undefined, surfaceProducer),
      tool("surface-sweep", "Sweep", "sweep", undefined, surfaceProducer),
      tool("surface-loft", "Loft", "loft", undefined, surfaceProducer),
      tool("surface-patch", "Patch", "face", undefined, surfaceProducer),
      tool("surface-offset", "Offset", "offset", undefined, surfaceProducer),
      tool("surface-ruled", "Ruled", "curve", undefined, surfaceProducer),
    ] },
    { id: "surface-modify", label: "Modify", tools: [
      tool("surface-trim", "Trim", "trim", undefined, surfaceProducer),
      tool("surface-extend", "Extend", "push-pull", undefined, surfaceProducer),
      tool("surface-stitch", "Stitch", "weld", undefined, surfaceProducer),
      tool("surface-unstitch", "Unstitch", "split", undefined, surfaceProducer),
      tool("surface-reverse-normal", "Reverse Normal", "normal", undefined, surfaceProducer),
      tool("surface-thicken", "Thicken", "thicken", undefined, surfaceProducer),
    ] },
  ],
};
