/** Framing — structural members cut and joined along sketch lines.
 *
 *  Onshape's framing list, in its order. Entirely greyed: framing needs a
 *  standard profile library and a member solver that trims, miters and gussets
 *  at the joints, and Aether has neither. Comparable structural work elsewhere lives
 *  in the BIM workbench, which this engine does not load.
 */
import { tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const framingWorkspace: CADRibbonWorkspaceDefinition = {
  id: "framing",
  label: "Framing",
  groups: [
    { id: "framing-create", label: "Create", tools: [
      tool("framing-frame", "Frame", "frame", "feature-frame-member"),
      tool("framing-trim", "Frame trim", "trim", "feature-frame-trim"),
      tool("framing-gusset", "Gusset", "weld", "feature-frame-gusset"),
      tool("framing-end-cap", "End cap", "sheet", "feature-frame-end-cap"),
      tool("framing-cut-list", "Cut list", "list", "framing-cut-list"),
    ] },
  ],
};
