/** Relations — the Assembly workspace's driven-motion tab.
 *
 *  Onshape's RELATIONS: one mate's motion driving another's. FreeCAD's solver
 *  has gear, rack-and-pinion, screw and belt joints; Aether's Assembly slice
 *  cannot author them yet, so they are greyed against that.
 */
import { authoringProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const assemblyRelationsWorkspace: CADRibbonWorkspaceDefinition = {
  id: "assembly-relations",
  label: "Relations",
  groups: [
    { id: "relations-create", label: "Relations", tools: [
      tool("assembly-relation-create", "Relation", "settings", "assembly-create-relation"),
      tool("assembly-gear", "Gears", "gears", undefined, authoringProducer),
      tool("assembly-mate-rack-pinion", "Rack and Pinion", "rack-pinion", undefined, authoringProducer),
      tool("assembly-mate-screw", "Screw", "thread", undefined, authoringProducer),
      tool("assembly-mate-belt", "Belt", "belt", undefined, authoringProducer),
    ] },
  ],
};
