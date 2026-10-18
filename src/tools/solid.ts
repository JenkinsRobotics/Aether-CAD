/** Solid — Fusion's SOLID tab: modelling, solid editing, reference geometry,
 *  transforms. The tab every Design workspace opens on, and the only one of
 *  the five whose tools mostly run. */
import { homeWorkspace } from "./home";
import { solidProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const solidWorkspace: CADRibbonWorkspaceDefinition = {
  id: "solid",
  label: "Solid",
  groups: [
    { id: "solid-create", label: "Create", tools: [
      // Fusion opens its Create list with Create Sketch, and it is the first
      // thing a new part needs. The Sketch tray itself is contextual.
      tool("solid-sketch", "Sketch", "sketch", "sketch"),
      // Distinct creation operations are peers, not variants of Extrude.
      tool("solid-extrude", "Extrude", "extrude", "feature-extrude"),
      tool("solid-revolve", "Revolve", "revolve", "feature-revolve"),
      tool("solid-sweep", "Sweep", "sweep", "feature-sweep"),
      tool("solid-loft", "Loft", "loft", "feature-loft"),
      tool("solid-hole", "Hole", "hole", "feature-hole"),
      tool("solid-box", "Box", "box", "create-box"),
      tool("solid-cylinder", "Cylinder", "cylinder", "create-cylinder"),
      tool("solid-cone", "Cone", "revolve", "create-cone"),
      tool("solid-sphere", "Sphere", "sphere", "create-sphere"),
      tool("solid-torus", "Torus", "revolve", "create-torus"),
      tool("solid-thread", "Thread", "thread", undefined, solidProducer),
      tool("solid-weld", "Weld", "weld", undefined, solidProducer),
      tool("solid-sheet", "Sheet", "sheet", undefined, solidProducer),
    ] },
    { id: "solid-edit", label: "Modify", tools: [
      tool("solid-cut", "Cut", "cut", "feature-cut"),
      // Every way of finishing an edge, behind one button.
      {...tool("solid-fillet", "Fillet", "fillet", "feature-fillet"), variants:[
        tool("solid-chamfer", "Chamfer", "chamfer", "feature-chamfer"),
        tool("solid-variable-fillet", "Variable Fillet", "fillet", undefined, solidProducer),
        tool("solid-face-fillet", "Face Fillet", "fillet", undefined, solidProducer),
      ]},
      tool("solid-boolean", "Boolean", "boolean", "feature-boolean"),
      tool("solid-shell", "Shell", "shell", "feature-shell"),
      tool("solid-split", "Split", "split", undefined, solidProducer),
      {...tool("solid-push-pull", "Push/Pull", "push-pull", "feature-face-extrude"), variants:[
        tool("solid-offset-face", "Move faces", "push-pull", "feature-offset-face"),
      ]},
      tool("solid-replace-face", "Replace", "replace-face", undefined, solidProducer),
      tool("solid-delete-face", "Delete", "remove", undefined, solidProducer),
    ] },
    { id: "solid-analysis", label: "Inspection", visibleToolCount: 2, tools: [
      tool("solid-inspect", "Measure", "measure", "show-inspect"),
      tool("solid-section", "Section View", "split", "part-section"),
      tool("solid-interference", "Interference Analysis", "split", "part-interference"),
      tool("solid-properties", "Physical properties", "measure", "part-properties"),
    ] },
    { id: "solid-reference", label: "Construction", singleTool: true, tools: [
      tool("solid-plane", "Offset Plane", "plane", "feature-plane"),
      tool("solid-plane-angle", "Plane at Angle", "plane", "construction-plane-angle"),
      tool("solid-plane-mid", "Midplane", "plane", "construction-plane-mid"),
      tool("solid-plane-three-point", "Plane Through Three Points", "plane", "construction-plane-three-point"),
    ] },
    { id: "solid-advanced", label: "Advanced Shape", tools: [
      tool("solid-partial-revolve", "Partial Revolve", "revolve", undefined, solidProducer),
      tool("solid-draft", "Draft", "draft", "feature-draft"),
      tool("solid-thicken", "Thicken", "thicken", undefined, solidProducer),
      tool("solid-pattern", "Pattern", "pattern", "feature-pattern"),
    ] },
    { id: "solid-transform", label: "Transform", tools: [
      // Moving a body is one gesture with several kinds.
      {...tool("solid-move", "Move", "move", "transform-translate"), variants:[
        tool("solid-copy", "Copy", "copy", "transform-copy"),
        tool("solid-rotate", "Rotate", "rotate", "transform-rotate"),
        tool("solid-scale", "Scale", "scale", "transform-scale"),
      ]},
      tool("solid-mirror", "Mirror", "mirror", "feature-mirror"),
    ] },
    ...homeWorkspace.groups,
  ],
};
