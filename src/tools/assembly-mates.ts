/** Mates — the Assembly workspace's joint tab.
 *
 *  Onshape's MATES, its Connect group in Onshape's order. A mate is offered
 *  only when both halves exist: FreeCAD's Assembly solver has the joint, and
 *  Aether's Assembly slice can author it. The rest are greyed and say which
 *  half is missing — see `dev/docs/roadmap/Mates_Engine_Decision.md`.
 */
import { authoringProducer, mateProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const assemblyMatesWorkspace: CADRibbonWorkspaceDefinition = {
  id: "assembly-mates",
  label: "Mates",
  groups: [
    { id: "mates-connect", label: "Connect", tools: [
      tool("assembly-fixed", "Fastened", "link", "assembly-mate-fastened"),
      tool("assembly-parallel", "Parallel", "parallel", undefined, authoringProducer),
      tool("assembly-slider", "Slider", "slider", "assembly-mate-prismatic"),
      tool("assembly-revolute", "Revolute", "hinge", "assembly-mate-revolute"),
      tool("assembly-concentric", "Cylindrical", "cylindrical", undefined, authoringProducer),
      // Onshape mates FreeCAD's solver has no joint for. Greyed, with the
      // reason, rather than offered and refused after authoring.
      tool("assembly-path", "Pin Slot", "slot", undefined, mateProducer),
      tool("assembly-coincident", "Planar", "plane", undefined, mateProducer),
      tool("assembly-mate-ball", "Ball", "ball", undefined, authoringProducer),
      tool("assembly-width", "Width", "symmetric", undefined, mateProducer),
      tool("assembly-tangent", "Tangent", "tangent", undefined, mateProducer),
      tool("assembly-perpendicular", "Perpendicular", "perpendicular", undefined, authoringProducer),
      tool("assembly-distance", "Distance", "measure", undefined, authoringProducer),
      tool("assembly-angle", "Angle", "angle", undefined, authoringProducer),
    ] },
    { id: "mates-connector", label: "Connector", tools: [
      tool("assembly-connector", "Connector", "connector", "assembly-add-connector"),
    ] },
    { id: "mates-edit", label: "Edit", tools: [
      tool("assembly-solve", "Solve", "check", "assembly-solve"),
      tool("assembly-mate-dof-value", "DOF Value", "rotate", "assembly-set-mate-dof-value"),
      tool("assembly-mate-dof-limits", "DOF Limits", "measure", "assembly-edit-mate-dof-limits"),
      tool("assembly-mate-suppress", "Suppress Mate", "suppressed", "assembly-toggle-mate-suppressed"),
      tool("assembly-mate-remove", "Remove Mate", "remove", "assembly-remove-mate"),
    ] },
  ],
};
