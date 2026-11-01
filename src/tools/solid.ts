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
      tool("solid-pipe", "Pipe", "sweep", "feature-pipe"),
      tool("solid-bounding-solid", "Bounding Solid", "box", "feature-bounding-solid"),
      tool("solid-shape-binder", "Shape Binder", "box", "feature-shape-binder"),
      tool("solid-thread", "Thread", "thread", "feature-thread"),
      tool("solid-coil", "Coil", "sweep", "feature-coil"),
      // Last of the real tools: the Create list opens downward without a height limit, so
      // each row added above Cone pushes it toward the bottom of the window.
      {...tool("solid-curve3d", "3D Sketch", "curve", "feature-curve3d"), variants: [
        tool("solid-intersection-curve", "Intersection curve", "curve", "sketch-intersection-curve"),
        tool("solid-isoparametric-curve", "Isoparametric curve", "curve", "sketch-isoparametric-curve"),
        tool("solid-project-to-surface", "Project to surface", "curve", "sketch-project-to-surface"),
      ]},
      tool("solid-weld", "Weld", "weld", undefined, solidProducer),
      tool("solid-sheet", "Sheet", "sheet", undefined, solidProducer),
    ] },
    { id: "solid-edit", label: "Modify", tools: [
      // Every way of finishing an edge, behind one button.
      {...tool("solid-fillet", "Fillet", "fillet", "feature-fillet"), variants:[
        tool("solid-chamfer", "Chamfer", "chamfer", "feature-chamfer"),
        tool("solid-variable-fillet", "Variable Fillet", "fillet", undefined, solidProducer),
        tool("solid-face-fillet", "Face Fillet", "fillet", undefined, solidProducer),
      ]},
      {...tool("solid-boolean", "Boolean", "boolean", "feature-boolean"), variants: [
        tool("solid-union", "Union", "boolean", "feature-union"),
        tool("solid-subtract", "Subtract", "boolean", "feature-subtract"),
        tool("solid-intersect", "Intersect", "boolean", "feature-intersect"),
        tool("solid-boundary-fill", "Boundary Fill", "boolean", "feature-boundary-fill"),
      ]},
      tool("solid-shell", "Shell", "shell", "feature-shell"),
      {...tool("solid-split", "Split Body", "split", "feature-split"), variants: [tool("solid-split-face", "Split Face", "split", "feature-split-face")]},
      {...tool("solid-push-pull", "Push/Pull", "push-pull", "feature-face-extrude"), variants:[
        tool("solid-offset-face", "Offset Face", "offset", "feature-offset-face"),
      ]},
      tool("solid-replace-face", "Replace Face", "replace-face", "feature-replace-face"),
      tool("solid-wrap-emboss", "Wrap & Emboss", "emboss", undefined,
        "Not available yet — wrapping sketch profiles onto faces and embossing them is not implemented."),
      tool("solid-delete-face", "Delete", "remove", "feature-delete-face"),
      tool("solid-remove-body", "Remove part", "remove", "feature-remove-body"),
    ] },
    { id: "solid-analysis", label: "Inspection", visibleToolCount: 2, tools: [
      tool("solid-inspect", "Measure", "measure", "show-inspect"),
      tool("solid-section", "Section View", "split", "part-section"),
      tool("solid-interference", "Interference Analysis", "split", "part-interference"),
      tool("solid-clearance", "Clearance", "measure", "part-clearance"),
      tool("solid-compare", "Compare Bodies", "measure", "part-compare"),
      tool("solid-properties", "Physical properties", "measure", "part-properties"),
      tool("solid-continuity", "Continuity", "curve", "part-continuity"),
      tool("solid-curvature-comb", "Curvature Comb", "curve", "part-curvature-comb"),
      tool("solid-isocurve", "Isocurves", "curve", "part-isocurve"),
      tool("solid-minimum-radius", "Minimum Radius", "curve", "part-minimum-radius"),
    ] },
    { id: "solid-reference", label: "Construction", singleTool: true, tools: [
      tool("solid-plane", "Offset Plane", "plane", "feature-plane"),
      tool("solid-plane-angle", "Plane at Angle", "plane", "construction-plane-angle"),
      tool("solid-plane-mid", "Midplane", "plane", "construction-plane-mid"),
      tool("solid-plane-three-point", "Plane Through Three Points", "plane", "construction-plane-three-point"),
      tool("solid-plane-perpendicular", "Perpendicular Plane", "plane", "construction-plane-perpendicular"),
      tool("solid-plane-two-edges", "Plane Through Two Edges", "plane", "construction-plane-two-edges"),
      tool("solid-plane-tangent", "Tangent Plane", "plane", "construction-plane-tangent"),
      tool("solid-plane-along-path", "Plane Along Path", "plane", "construction-plane-along-path"),
      tool("solid-axis-edge", "Axis Through Edge", "plane", "construction-axis-edge"),
      tool("solid-axis-two-points", "Axis Through Two Points", "plane", "construction-axis-two-points"),
      tool("solid-axis-normal", "Axis Normal to Plane", "plane", "construction-axis-normal-to-plane"),
      tool("solid-axis-two-planes", "Axis Through Two Planes", "plane", "construction-axis-two-planes"),
      tool("solid-axis-cylinder", "Axis Through Cylinder", "plane", "construction-axis-edge"),
      tool("solid-point-vertex", "Point At Vertex", "plane", "construction-point-vertex"),
      tool("solid-point-two-edges", "Point Through Two Edges", "plane", "construction-point-two-edges"),
      tool("solid-point-three-planes", "Point Through Three Planes", "plane", "construction-point-three-planes"),
      tool("solid-point-center", "Point At Center Of Circle", "plane", "construction-point-center"),
      tool("solid-point-edge-plane", "Point At Edge And Plane", "plane", "construction-point-edge-plane"),
      tool("solid-point-along-path", "Point Along Path", "plane", "construction-point-along-path"),
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
        tool("solid-align", "Align", "move", "transform-align"),
      ]},
      {...tool("solid-mirror", "Mirror", "mirror", "feature-mirror"), variants:[
        tool("solid-mirror-parts", "Mirror parts", "mirror", "transform-mirror"),
      ]},
    ] },
    ...homeWorkspace.groups,
  ],
};
