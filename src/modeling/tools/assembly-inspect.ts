/** Inspect — the Assembly workspace's measurement and review tab.
 *
 *  Onshape's INSPECT. Mostly greyed: measurement and interference need an
 *  exact analysis contract and a result producer, neither of which exists.
 */
import { projectProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const assemblyInspectWorkspace: CADRibbonWorkspaceDefinition = {
  id: "assembly-inspect",
  label: "Inspect",
  groups: [
    { id: "inspect-review", label: "Review", tools: [
      tool("assembly-properties", "Properties", "properties", "show-mates"),
      tool("assembly-explode", "Explode", "move", "assembly-explode"),
      tool("assembly-material", "Material", "material", undefined, projectProducer),
    ] },
    { id: "inspect-measure", label: "Measure", tools: [
      tool("assembly-mass", "Mass & Health", "mass", "assembly-mass"),
      tool("assembly-clearance", "Clearance", "measure", "assembly-clearance"),
      tool("assembly-interference", "Interference", "split", "assembly-interference"),
    ] },
  ],
};
