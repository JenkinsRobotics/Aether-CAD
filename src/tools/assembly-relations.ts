/** Relations — the Assembly workspace's driven-motion tab.
 *
 *  Onshape's RELATIONS: one mate's motion driving another's. The assembly solver
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
      tool("assembly-motion-study", "Motion study", "rotate", "assembly-motion-study"),
      tool("assembly-contact-set", "Contact set", "weld", "assembly-create-contact-set"),
      tool("assembly-contacts-toggle", "Contacts on/off", "check", "assembly-toggle-contacts"),
      tool("assembly-contacts-check", "Check contacts", "measure", "assembly-check-contacts"),
      // Gear, rack-and-pinion and screw are the kind field of the Relation dialog.
      tool("assembly-mate-belt", "Belt", "belt", undefined, authoringProducer),
    ] },
  ],
};
