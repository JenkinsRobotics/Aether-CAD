/** Framing — structural members cut and joined along sketch lines.
 *
 *  Onshape's framing list, in its order. Entirely greyed: framing needs a
 *  standard profile library and a member solver that trims, miters and gussets
 *  at the joints, and Aether has neither. FreeCAD's own structural work lives
 *  in the BIM workbench, which this engine does not load.
 */
import { framingProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const framingWorkspace: CADRibbonWorkspaceDefinition = {
  id: "framing",
  label: "Framing",
  groups: [
    { id: "framing-create", label: "Create", tools: [
      tool("framing-frame", "Frame", "frame", undefined, framingProducer),
      tool("framing-trim", "Frame trim", "trim", undefined, framingProducer),
      tool("framing-gusset", "Gusset", "weld", undefined, framingProducer),
      tool("framing-end-cap", "End cap", "sheet", undefined, framingProducer),
      tool("framing-cut-list", "Cut list", "list", undefined, framingProducer),
    ] },
  ],
};
