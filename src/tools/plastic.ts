/** Plastic — Fusion's PLASTIC tab. Moulded-part detail features.
 *
 *  Draft and Shell share the existing native solid operations. The other entries are
 *  planned: FreeCAD has no plastic-part workbench, so these are
 *  Aether Kernel features rather than translation gaps. Kept in the planning catalog so the
 *  Design taxonomy is complete and the missing half is on the record.
 */
import { plasticProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const plasticWorkspace: CADRibbonWorkspaceDefinition = {
  id: "plastic",
  label: "Plastic",
  groups: [
    { id: "plastic-create", label: "Create", tools: [
      tool("plastic-rule-fillet", "Rule Fillet", "fillet", undefined, plasticProducer),
      tool("plastic-boss", "Boss", "hole", undefined, plasticProducer),
      tool("plastic-snap-fit", "Snap Fit", "hinge", undefined, plasticProducer),
      tool("plastic-rib", "Rib", "frame", undefined, plasticProducer),
      tool("plastic-web", "Web", "grid", undefined, plasticProducer),
      tool("plastic-lip-groove", "Lip / Groove", "slot", undefined, plasticProducer),
    ] },
    { id: "plastic-modify", label: "Modify", tools: [
      tool("plastic-draft", "Draft", "draft", "feature-draft"),
      tool("plastic-shell", "Shell", "shell", "feature-shell"),
    ] },
  ],
};
