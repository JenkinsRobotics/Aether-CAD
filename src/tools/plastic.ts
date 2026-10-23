/** Plastic — Fusion's PLASTIC tab. Moulded-part detail features.
 *
 *  Draft and Shell share the existing native solid operations. The other entries are
 *  planned: the engine has no plastic-part features, so these are
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
      tool("plastic-boss", "Boss", "hole", "feature-boss"),
      tool("plastic-rest", "Rest", "box", "feature-rest"),
      tool("plastic-snap-fit", "Snap Fit", "hinge", "feature-snap-fit"),
      tool("plastic-rib", "Rib", "frame", "feature-extrude"),
      tool("plastic-web", "Web", "grid", "feature-extrude"),
      tool("plastic-lip-groove", "Lip / Groove", "slot", "feature-lip"),
    ] },
    { id: "plastic-modify", label: "Modify", tools: [
      tool("plastic-draft", "Draft", "draft", "feature-draft"),
      tool("plastic-shell", "Shell", "shell", "feature-shell"),
      tool("plastic-rules", "Plastic Rules", "settings", "show-plastic-rules"),
    ] },
  ],
};
