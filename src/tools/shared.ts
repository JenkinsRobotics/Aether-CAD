/** Types and builders every ribbon tray shares.
 *
 *  A tool is defined once, here or in the tray file that shows it, and
 *  nowhere else — layouts only ever reference tools by id.
 */
import { sketchConstraintCatalog } from "../sketch/constraint-catalog";
import type { ToolIconName } from "@aether/ui";
import type { CADCommandID } from "../cad-command-registry";

export type CADRibbonWorkspaceID =
  | "home"
  | "sketch"
  | "solid"
  | "surface"
  | "mesh"
  | "sheet-metal"
  | "framing"
  | "plastic"
  | "assembly-build"
  | "assembly-mates"
  | "assembly-relations"
  | "assembly-inspect"
  | "view"
  | "manage"
  | "output";

export type CADToolActionID = CADCommandID
  | "new-assembly"
  | "open-assembly"
  | "save-assembly"
  | "insert-canvas" | "insert-decal"
  | "insert-mcmaster"
  | "insert-vector-svg" | "insert-vector-dxf" | "insert-mesh"
  | "show-home"
  | "show-recovery"
  | "show-preferences"
  | "show-help"
  | "show-export"
  | "open-drawing"
  | "show-design-workspace"
  | "show-assembly-workspace"
  | "show-items"
  | "show-parameters"
  | "show-mates"
  | "show-inspect"
  | "show-visualization"
  | "show-history"
  | "reset-panels";

export interface CADToolDefinition {
  id: string;
  label: string;
  icon: ToolIconName;
  action?: CADToolActionID;
  unavailableReason?: string;
  variants?: CADToolDefinition[];
}

export interface CADToolGroupDefinition {
  /** Expose one primary tool and keep the remaining commands in its group menu. */
  singleTool?: boolean;
  /** Number of primary icons; all tools remain available in the group menu. */
  visibleToolCount?: number;
  id: string;
  label: string;
  /** Icon for the group itself, where a surface shows the group before its
   *  tools — the viewport's View rail collapses each group behind one button. */
  icon?: ToolIconName;
  tools: readonly CADToolDefinition[];
}

export interface CADRibbonWorkspaceDefinition {
  id: CADRibbonWorkspaceID;
  label: string;
  groups: readonly CADToolGroupDefinition[];
}

// A greyed tool is one the Aether engine cannot build yet. The engine
// has most of these; what is missing is the translation in
// the engine's evaluator (`aether-engine/src/kernel/part-evaluator.ts`). Naming
// that is the difference between "broken" and "not wired up yet".
export const solidProducer = "The Aether engine does not build this feature yet.";
// The assembly solver has nine joint kinds; these two Onshape mates
// are not among them, so they stay greyed rather than failing after the user
// has authored the whole mate.
// The solver would handle these, but a mate is still committed through the
// workspace's Assembly slice, which stores the eight kinematic kinds (fastened,
// revolute, prismatic, cylindrical, ball, planar, pin slot, parallel) and has
// no record for a distance, angle or perpendicular mate yet.
// Both halves have to be there before a button may be offered.
export const authoringProducer = "The solver handles this mate, but Assembly v1 cannot author it yet.";
export const mateProducer = "The assembly solver has no joint for this mate yet.";
export const assemblyProducer = "Requires a canonical Core Assembly mutation or mate solver command that is not connected yet.";
export const analysisProducer = "Requires an exact Core analysis contract and result producer.";
export const exportProducer = "Requires a canonical Core export producer for this format.";
export const projectProducer = "Requires persistent workspace metadata that is not connected yet.";
// The four Design tabs Aether names but cannot build. Each says which half is
// missing — a translation, a body type, an add-on, or the feature itself —
// so a greyed button is a review item, not a mystery.
export const surfaceProducer = "The Aether engine does not build this surface tool yet.";
export const meshProducer = "Aether has no mesh body type; nothing carries a mesh across the engine boundary yet.";
export const sheetMetalProducer = "The Aether engine does not build this sheet metal tool yet.";
export const framingProducer = "Framing needs a standard profile library and a member solver that trims and joins at the joints; Aether has neither.";
export const plasticProducer = "Plastic-part features need an Aether engine feature that is not built yet.";

export const tool = (
  id: string,
  label: string,
  icon: ToolIconName,
  action?: CADToolActionID,
  unavailableReason?: string,
): CADToolDefinition => ({ id, label, icon, action, unavailableReason });

/** Icon for a constraint kind. Falls back to a neutral glyph so a newly added
 *  kind shows up rather than crashing the ribbon. */
const constraintIcon = (kind: string): ToolIconName =>
  (({
    coincident: "point", horizontal: "parallel", vertical: "perpendicular",
    parallel: "parallel", perpendicular: "perpendicular", concentric: "concentric",
    equal: "parallel", midpoint: "point", tangent: "tangent", curvature: "curvature",
    normal: "normal", symmetric: "symmetric", quadrant: "quadrant",
    "ellipse-shape": "ellipse", "ellipse-locus": "ellipse", "spline-shape": "curve",
    offset: "offset", slot: "slot", distance: "measure",
    "horizontal-distance": "measure", "vertical-distance": "measure",
    length: "measure", radius: "circle", diameter: "circle", angle: "angle",
    fix: "ground",
  }) as Record<string, ToolIconName>)[kind] ?? "point";

const constraintTool = (kind: string, label: string): CADToolDefinition =>
  tool(`sketch-constraint-${kind}`, label, constraintIcon(kind), `sketch-constraint-${kind}` as CADToolActionID);

/** One Constrain button; every other relationship lives in its dropdown, in
 *  Onshape's menu order. */
export const constraintRibbonTool = (): CADToolDefinition => {
  const [first, ...rest] = sketchConstraintCatalog;
  return {
    ...constraintTool(first.kind, first.label),
    id: "sketch-constrain",
    variants: rest.map((entry) => constraintTool(entry.kind, entry.label)),
  };
};

/** One Dimension button. Onshape drives every dimension type from this tool
 *  rather than listing them beside the relationships. */
export const dimensionRibbonTool = (): CADToolDefinition => ({
  ...constraintTool("distance", "Dimension"),
  id: "sketch-dimension",
  icon: "measure",
  label: "Dimension",
});
