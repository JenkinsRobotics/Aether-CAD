/** Mates — the Assembly workspace's joint tab.
 *
 *  Onshape's MATES, its Connect group in Onshape's order. A mate is offered
 *  only when both halves exist: the assembly solver has the joint, and
 *  Aether's Assembly slice can author it. The rest are greyed and say which
 *  half is missing — see `dev/docs/roadmap/Mates_Engine_Decision.md`.
 */
import {authoringProducer, mateProducer, tool, type CADRibbonWorkspaceDefinition} from "./shared";

export const assemblyMatesWorkspace: CADRibbonWorkspaceDefinition = {
  id: "assembly-mates",
  label: "Mates",
  groups: [
    { id: "mates-connect", label: "Connect", tools: [
      tool("assembly-fixed", "Fastened", "link", "assembly-mate-fastened"),
      tool("assembly-parallel", "Parallel", "parallel", "assembly-mate-parallel"),
      tool("assembly-slider", "Slider", "slider", "assembly-mate-prismatic"),
      tool("assembly-revolute", "Revolute", "hinge", "assembly-mate-revolute"),
      tool("assembly-concentric", "Cylindrical", "cylindrical", "assembly-mate-cylindrical"),
      tool("assembly-path", "Pin Slot", "slot", "assembly-mate-pin_slot"),
      tool("assembly-coincident", "Planar", "plane", "assembly-mate-planar"),
      tool("assembly-mate-ball", "Ball", "ball", "assembly-mate-ball"),
      tool("assembly-as-built", "As-Built Joint", "link", "assembly-as-built-joint"),
      tool("assembly-rigid-group", "Rigid Group", "ground", "assembly-rigid-group"),
      tool("assembly-unlock", "Unlock", "ground", "assembly-unlock"),
      tool("assembly-reach", "Reach Point", "fit", "assembly-reach-point"),
      // Width and tangent need surface geometry the solver has no joint for;
      // perpendicular, distance and angle the solver handles but the
      // workspace cannot store. Greyed with the reason, rather than offered
      // and refused after authoring.
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
