import type { ConstraintIconName } from "./constraint-icons";
import type { DrawingConstraintKind } from "@aether/core/sketch";

/** The canonical constraint catalog: order, labels, icons and shortcuts, taken
 *  from Onshape's Constrain menu so the ribbon, the canvas marks and the hover
 *  readout all render the same thing. One list — adding a constraint here makes
 *  it appear in every surface at once.
 *
 *  `icon` references shared monochrome SVG artwork for compact relationship marks. */
export interface SketchConstraintEntry {
  kind: DrawingConstraintKind;
  label: string;
  icon: ConstraintIconName;
  /** Onshape's keyboard shortcut, shown in the menu. */
  shortcut: string;
}

/** Relationships, in Onshape's menu order. Dimensions are a separate concept
 *  and are listed below. */
export const sketchConstraintCatalog: readonly SketchConstraintEntry[] = [
  { kind: "coincident", label: "Coincident", icon: "coincident", shortcut: "i" },
  { kind: "pierce", label: "Pierce", icon: "pierce", shortcut: "shift g" },
  { kind: "concentric", label: "Concentric", icon: "concentric", shortcut: "shift o" },
  { kind: "parallel", label: "Parallel", icon: "parallel", shortcut: "b" },
  { kind: "tangent", label: "Tangent", icon: "tangent", shortcut: "t" },
  { kind: "horizontal", label: "Horizontal", icon: "horizontal", shortcut: "h" },
  { kind: "vertical", label: "Vertical", icon: "vertical", shortcut: "v" },
  { kind: "perpendicular", label: "Perpendicular", icon: "perpendicular", shortcut: "shift l" },
  { kind: "equal", label: "Equal", icon: "equal", shortcut: "e" },
  { kind: "midpoint", label: "Midpoint", icon: "midpoint", shortcut: "shift m" },
  { kind: "normal", label: "Normal", icon: "normal", shortcut: "shift k" },
  { kind: "symmetric", label: "Symmetric", icon: "symmetric", shortcut: "shift q" },
  { kind: "fix", label: "Fix", icon: "fix", shortcut: "shift j" },
  { kind: "curvature", label: "Curvature", icon: "curvature", shortcut: "shift u" },
] as const;

/** Dimensional constraints. Onshape puts these on the Dimension tool rather
 *  than the Constrain menu, and they draw as annotations, not glyph badges. */
export const sketchDimensionKinds: readonly DrawingConstraintKind[] = [
  "distance",
  "horizontal-distance",
  "vertical-distance",
  "length",
  "radius",
  "diameter",
  "conic-rho",
  "angle",
] as const;

const byKind = new Map(sketchConstraintCatalog.map((entry) => [entry.kind, entry]));

export function sketchConstraintEntry(kind: string): SketchConstraintEntry | undefined {
  return byKind.get(kind as DrawingConstraintKind);
}

/** True when this constraint draws as a dimension annotation instead of a badge. */
export function isDimensionConstraint(kind: string): boolean {
  return (sketchDimensionKinds as readonly string[]).includes(kind);
}
