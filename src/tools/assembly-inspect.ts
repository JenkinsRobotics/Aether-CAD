/** Inspect — the Assembly workspace's measurement and review tab.
 *
 *  Onshape's INSPECT. Mostly greyed: measurement and interference need an
 *  exact analysis contract and a result producer, neither of which exists.
 */
import { analysisProducer, assemblyProducer, projectProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const assemblyInspectWorkspace: CADRibbonWorkspaceDefinition = {
  id: "assembly-inspect",
  label: "Inspect",
  groups: [
    { id: "inspect-review", label: "Review", tools: [
      tool("assembly-properties", "Properties", "properties", "show-mates"),
      tool("assembly-section", "Section", "split", undefined, analysisProducer),
      tool("assembly-explode", "Explode", "move", undefined, assemblyProducer),
      tool("assembly-material", "Material", "material", undefined, projectProducer),
    ] },
    { id: "inspect-measure", label: "Measure", tools: [
      tool("assembly-mass", "Mass & Health", "mass", undefined, analysisProducer),
      tool("assembly-measure", "Measure", "measure", undefined, analysisProducer),
      tool("assembly-clearance", "Clearance", "measure", undefined, analysisProducer),
      tool("assembly-interference", "Interference", "split", undefined, analysisProducer),
    ] },
  ],
};
