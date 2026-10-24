/** Sketch — drawing tools, constraints and dimensions.
 *
 *  Contextual: this tray is only up while a sketch is being edited. It starts
 *  no sketch of its own — nobody draws a sketch inside a sketch — so Create
 *  begins at Point. Solid > Modeling owns Create Sketch.
 */
import { constraintRibbonTool, dimensionRibbonTool, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const sketchWorkspace: CADRibbonWorkspaceDefinition = {
  id: "sketch",
  label: "Sketch",
  groups: [
    { id: "sketch-edit", label: "Edit", tools: [
      tool("sketch-construction", "Construction", "construction", "sketch-construction"),
      { ...tool("sketch-coordinates", "Edit", "settings", "sketch-coordinates"), variants: [
        tool("sketch-undo", "Undo", "undo", "sketch-undo"),
        tool("sketch-redo", "Redo", "redo", "sketch-redo"),
        tool("sketch-delete", "Delete", "remove", "sketch-delete"),
        tool("sketch-unfix", "Unfix selected geometry", "ground", "sketch-unfix"),
        tool("sketch-change-plane", "Change sketch plane", "plane", "sketch-change-plane"),
        tool("sketch-auto-constrain", "AutoConstrain", "parallel", "sketch-auto-constrain"),
        tool("sketch-auto-constrain-datum", "AutoConstrain from datum", "parallel", "sketch-auto-constrain-datum"),
        tool("sketch-finish-auto-constrain", "Finish with AutoConstrain", "check", "sketch-finish-auto-constrain"),
        tool("sketch-loose-ends", "Loose ends", "parallel", "sketch-loose-ends"),
        tool("sketch-infinite", "Infinite line", "line", "sketch-infinite"),
        tool("sketch-polygon-constraint", "Polygon", "polygon", "sketch-polygon-constraint"),
        tool("sketch-chain", "Chain", "parallel", "sketch-chain"),
        tool("sketch-constraints", "Constraint editor", "parallel", "sketch-constraints"),
        tool("sketch-variables", "Variables", "settings", "sketch-variables"),
        tool("sketch-clipboard", "Clipboard", "copy", "sketch-clipboard"),
      ] },
    ] },
    { id: "sketch-create", label: "Create", tools: [
      tool("sketch-point", "Point", "point", "sketch-point"),
      {...tool("sketch-line", "Line", "line", "sketch-line"), variants:[tool("sketch-midpoint-line", "Midpoint line", "midpoint-line", "sketch-midpoint-line")]},
      {...tool("sketch-arc", "Arc", "arc", "sketch-arc"), variants:[tool("sketch-center-arc", "Center point arc", "center-arc", "sketch-center-arc"), tool("sketch-tangent-arc", "Tangent arc", "tangent-arc", "sketch-tangent-arc"), tool("sketch-elliptical-arc", "Elliptical arc", "elliptical-arc", "sketch-elliptical-arc")]},
      {...tool("sketch-spline", "Spline", "curve", "sketch-cubic-bezier"), variants:[tool("sketch-conic", "Conic", "curve", "sketch-conic"), tool("sketch-fit-spline", "Fit-point spline", "curve", "sketch-fit-spline"), tool("sketch-control-spline", "Control point spline", "curve", "sketch-control-spline"), tool("sketch-control-spline-5", "Control point spline (degree 5)", "curve", "sketch-control-spline-5"), tool("sketch-insert-spline-point", "Insert spline point", "point", "sketch-insert-spline-point"), tool("sketch-blend-curve", "Blend curve (tangent)", "curve", "sketch-blend-curve"), tool("sketch-blend-curve-g2", "Blend curve (curvature)", "curve", "sketch-blend-curve-g2")]},
      {...tool("sketch-rectangle", "Rectangle", "rectangle", "sketch-rectangle"), variants:[tool("sketch-center-rectangle", "Center point rectangle", "center-rectangle", "sketch-center-rectangle"),tool("sketch-rounded-rectangle", "Rounded rectangle", "rectangle", "sketch-rounded-rectangle"), tool("sketch-aligned-rectangle", "Aligned rectangle", "aligned-rectangle", "sketch-aligned-rectangle")]},
      {...tool("sketch-circle", "Circle", "circle", "sketch-circle"), variants:[tool("sketch-three-point-circle", "3 point circle", "circle-three-point", "sketch-three-point-circle"),tool("sketch-two-point-circle", "2 point circle", "circle", "sketch-two-point-circle"),tool("sketch-two-tangent-circle", "2 tangent circle", "circle", "sketch-two-tangent-circle"),tool("sketch-three-tangent-circle", "3 tangent circle", "circle", "sketch-three-tangent-circle"),tool("sketch-ellipse", "Ellipse", "ellipse", "sketch-ellipse")]},
      {...tool("sketch-polygon", "Polygon", "polygon", "sketch-inscribed-polygon"), variants:[tool("sketch-circumscribed-polygon", "Circumscribed polygon", "circumscribed-polygon", "sketch-circumscribed-polygon"),tool("sketch-edge-polygon", "Edge polygon", "polygon", "sketch-edge-polygon")]},
    ] },
    { id: "sketch-modify", label: "Modify", tools: [
      tool("sketch-mirror", "Mirror", "mirror", "sketch-mirror"),
      {...tool("sketch-linear-pattern", "Pattern", "pattern", "sketch-linear-pattern"), variants:[tool("sketch-circular-pattern", "Circular pattern", "pattern", "sketch-circular-pattern"), tool("sketch-transform", "Transform", "move", "sketch-transform")]},
      {...tool("sketch-fillet", "Fillet", "fillet", "sketch-fillet"), variants:[tool("sketch-chamfer", "Chamfer", "chamfer", "sketch-chamfer")]},
      {...tool("sketch-offset", "Offset", "offset", "sketch-offset"), variants:[tool("sketch-slot", "Slot", "slot", "sketch-slot"),tool("sketch-center-slot", "Center to center slot", "slot", "sketch-center-slot"),tool("sketch-overall-slot", "Overall slot", "slot", "sketch-overall-slot"),tool("sketch-center-point-slot", "Center point slot", "slot", "sketch-center-point-slot"),tool("sketch-center-arc-slot", "Center point arc slot", "slot", "sketch-center-arc-slot"),tool("sketch-three-point-arc-slot", "Three point arc slot", "slot", "sketch-three-point-arc-slot")]},
      {...tool("sketch-trim", "Trim", "trim", "sketch-trim"), variants:[tool("sketch-extend", "Extend", "line", "sketch-extend"), tool("sketch-split", "Split", "trim", "sketch-split"), tool("sketch-break", "Break", "trim", "sketch-break")]},
      {...tool("sketch-project-geometry", "Project", "plane", "sketch-project-geometry"), variants:[tool("sketch-intersect", "Intersect", "plane", "sketch-intersect"), tool("sketch-include-edges", "Include 3D edges", "plane", "sketch-include-edges")]},
    ] },
    // Onshape collapses relationships into ONE Constrain button with a
    // dropdown, and dimensions onto a separate Dimension tool — not 26 flat
    // buttons. Both lists come from the constraint catalog so the ribbon, the
    // canvas glyphs and the keyboard map can never disagree.
    // Two separate groups, not one: the contextual Sketch tab gives each
    // section a single dropdown, so pairing them would put relationships and
    // dimensions in one mixed menu. One icon each, everything else behind it.
    { id: "sketch-constraints", label: "Constrain", tools: [constraintRibbonTool()] },
    { id: "sketch-dimensions", label: "Dimension", tools: [dimensionRibbonTool()] },
    { id: "sketch-insert", label: "Insert", tools: [tool("sketch-text", "Text", "text", "sketch-text"), tool("sketch-vector", "Vector tools", "boolean", "sketch-vector"), tool("sketch-import-dxf", "DXF", "import", "sketch-import-dxf"), tool("sketch-export-dxf", "Save as DXF", "import", "sketch-export-dxf")] },
    // No Navigate group: Select, Pan and Fit are viewport controls, not sketch
    // tools, and Onshape's sketch toolbar carries none of them. Escape returns
    // to Select, and clicking an active tool toggles back to it.
  ],
};
