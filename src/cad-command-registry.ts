import { contextualDrawingTools, type ContextualDrawingTool } from "./sketch/tangent-arc-tool";
import { directModificationTools,type DirectModificationTool,modificationTools, type ModificationTool } from "./sketch/tool-instructions";
import type { SketchVariantTool } from "@aether/core/sketch";
import { sketchVariantTools } from "@aether/core/sketch";
import { drawingConstraintKinds, type DrawingConstraintKind } from "@aether/core/sketch";
export type CADCommandID =
  | `sketch-${ContextualDrawingTool}`
  | `sketch-constraint-${DrawingConstraintKind}`
  | `sketch-${DirectModificationTool}`
  | `sketch-${ModificationTool}`
  | `sketch-${SketchVariantTool}`
  | "sketch-project"
  | "sketch-text"
  | "sketch-project-geometry"
  | "sketch-vector"
  | "sketch-import-dxf"
  | "sketch-undo"
  | "sketch-redo"
  | "sketch-finish-spline" | "sketch-remove-spline-point"
  | "sketch-unfix" | "sketch-infinite" | "sketch-polygon-constraint" | "sketch-chain" | "sketch-finish-auto-constrain" | "sketch-auto-constrain" | "sketch-export-dxf" | "sketch-intersect" | "sketch-include-edges" | "sketch-two-tangent-circle" | "sketch-three-tangent-circle" | "sketch-change-plane" | "sketch-loose-ends"
  | "sketch-coordinates"
  | "sketch-constraints"
  | "sketch-variables"
  | "sketch-clipboard"
  | "sketch-construction" | "sketch-delete"
  | "sketch-select" | "sketch-line" | "sketch-arc" | "sketch-circle" | "sketch-rectangle"
  | "construction-plane-angle"
  | "construction-plane-mid"
  | "construction-plane-three-point" | "construction-plane-perpendicular" | "construction-plane-two-edges" | "construction-plane-tangent" | "construction-plane-along-path"
  | "construction-axis-edge" | "construction-axis-two-points" | "construction-axis-normal-to-plane" | "construction-axis-two-planes"
  | "construction-point-vertex" | "construction-point-two-edges" | "construction-point-three-planes" | "construction-point-center" | "construction-point-edge-plane" | "construction-point-along-path"
  | "feature-plane"
  | "feature-profile"
  | "feature-extrude"
  | "feature-revolve"
  | "feature-mirror"
  | "feature-fillet"
  | "feature-chamfer"
  | "feature-sweep"
  | "feature-transform"
  | "transform-translate" | "transform-rotate" | "transform-scale" | "transform-copy" | "transform-mirror" | "transform-align"
  | "feature-offset-face"
  | "feature-face-extrude"
  | "feature-shell"
  | "feature-boolean"
  | "feature-pattern"
  | "feature-draft"
  | "feature-loft"
  | "feature-import-step" | "feature-import-cad" | "feature-sheet-base" | "feature-sheet-flange" | "feature-sheet-hem" | "feature-sheet-fold" | "feature-sheet-unfold" | "feature-sheet-refold" | "sheet-export-flat-dxf" | "show-configurations" | "timeline-copy-features" | "timeline-paste-features"
  | "feature-surface-boundary" | "feature-surface-blend" | "feature-surface-untrim" | "feature-surface-ruled" | "feature-surface-extend" | "feature-surface-extrude" | "feature-surface-revolve" | "feature-surface-loft" | "feature-surface-patch" | "feature-surface-sweep" | "feature-surface-offset" | "feature-surface-thicken" | "feature-surface-stitch" | "feature-surface-unstitch" | "feature-surface-reverse-normal"
  | "feature-hole" | "feature-split" | "feature-delete-face" | "feature-pipe" | "feature-bounding-solid" | "feature-thread" | "feature-coil" | "feature-remove-body" | "feature-boss" | "feature-rest"
  | "part-section"
  | "part-properties"
  | "part-interference" | "part-clearance" | "part-compare"
  | "measure"
  | "part-undo"
  | "part-redo"
  | "section-view"
  | "engine-build"

  | "new-part"
  | "open-part"
  | "save-part"
  | "commit-part"
  | "insert-step"
  | "sketch"
  | "rebuild-part"
  | "connector"
  | "fastened"
  | "assembly-insert-component"
  | "assembly-part-template" | "assembly-from-json" | "assembly-linear-array" | "assembly-circular-array" | "assembly-undo-recipe" | "assembly-redo-recipe"
  | "assembly-add-connector"
  | "assembly-create-mate"
  | "assembly-set-mate-dof-value"
  | "assembly-edit-mate-dof-limits"
  | "assembly-create-relation" | "assembly-explode" | "assembly-motion-study"
  | "assembly-toggle-mate-suppressed"
  | "assembly-remove-mate"
  | "assembly-mate-fastened"
  | "assembly-mate-revolute"
  | "assembly-mate-cylindrical"
  | "assembly-mate-prismatic"
  | "assembly-mate-ball"
  | "assembly-mate-distance"
  | "assembly-mate-parallel"
  | "assembly-mate-perpendicular"
  | "assembly-mate-angle"
  | "assembly-mate-planar"
  | "assembly-mate-pin_slot"
  | "assembly-mate-rack-pinion"
  | "assembly-mate-screw"
  | "assembly-mate-gears"
  | "assembly-mate-belt"
  | "assembly-solve"
  | "assembly-toggle-grounded"
  | "assembly-toggle-suppressed"
  | "assembly-remove-instance"
  | "fit-view"
  | "clear-mates"
  | "view-top"
  | "view-bottom"
  | "view-front"
  | "view-back"
  | "view-right"
  | "view-left"
  | "view-isometric"
  | "display-shaded"
  | "display-shaded-edges"
  | "display-wireframe"
  | "display-hidden-line"
  | "display-ghost" | "display-zebra" | "display-draft-analysis" | "display-curvature-map" | "display-accessibility"
  | "lighting-studio"
  | "lighting-softbox"
  | "lighting-daylight"
  | "lighting-dark-room"
  | "toggle-contact-shadows"
  | "background-graphite"
  | "background-midnight"
  | "background-cad-light"
  | "background-blueprint"
  | "finish-matte"
  | "finish-satin"
  | "finish-gloss"
  | "ground-none"
  | "ground-grid"
  | "ground-floor"
  | "ground-both"
  | "toggle-origin"
  | "toggle-axes"
  | "toggle-feature-edges"
  | "reset-appearance"
  | "selection-auto"
  | "selection-component"
  | "selection-body"
  | "selection-face"
  | "selection-edge"
  | "selection-vertex"
  | "selection-next-filter"
  | "selection-directional" | "selection-window" | "selection-crossing" | "selection-clear"
  | "selection-freeform" | "selection-paint"
  | "selection-priority-body" | "selection-priority-face" | "selection-priority-edge";

export interface CADCommandState {
  enabled: boolean;
  active: boolean;
  registered: boolean;
}

type Handler = () => void | Promise<void>;
type Listener = () => void;

/** Constraint kinds that surface as commands; "pattern" authors through the
 * pattern group editor instead. Boot registration must use this same list —
 * registering an id absent from cadCommandIDs breaks startup. */
export const sketchConstraintCommandKinds: readonly DrawingConstraintKind[] =
  drawingConstraintKinds.filter((kind) => kind !== "pattern");

export const cadCommandIDs: readonly CADCommandID[] = [
  ...contextualDrawingTools.map(tool=>`sketch-${tool}` as const),
  ...sketchConstraintCommandKinds.map(kind => `sketch-constraint-${kind}` as const),
  ...directModificationTools.map(tool=>`sketch-${tool}` as const),
  ...modificationTools.map(tool=>`sketch-${tool}` as const),
  ...sketchVariantTools.map(tool => `sketch-${tool}` as const),
  "sketch-project",
  "sketch-project-geometry",
  "sketch-text",
  "sketch-vector",
  "sketch-import-dxf",
  "sketch-undo",
  "sketch-redo",
  "sketch-finish-spline", "sketch-remove-spline-point",
  "sketch-unfix", "sketch-infinite", "sketch-polygon-constraint", "sketch-chain", "sketch-finish-auto-constrain", "sketch-auto-constrain", "sketch-export-dxf", "sketch-intersect", "sketch-include-edges", "sketch-two-tangent-circle", "sketch-three-tangent-circle", "sketch-change-plane", "sketch-loose-ends",
  "sketch-coordinates",
  "sketch-constraints",
  "sketch-variables",
  "sketch-clipboard",
  "sketch-construction", "sketch-delete",
  "sketch-select", "sketch-line", "sketch-arc", "sketch-circle", "sketch-rectangle",
  "construction-plane-angle", "construction-plane-mid", "construction-plane-three-point", "construction-plane-perpendicular", "construction-plane-two-edges", "construction-plane-tangent", "construction-plane-along-path",
  "construction-axis-edge", "construction-axis-two-points", "construction-axis-normal-to-plane", "construction-axis-two-planes",
  "construction-point-vertex", "construction-point-two-edges", "construction-point-three-planes", "construction-point-center", "construction-point-edge-plane", "construction-point-along-path",
  "feature-plane", "feature-profile",
  "feature-extrude",
  "feature-revolve",
  "feature-mirror",
  "feature-fillet",
  "feature-chamfer",
  "feature-sweep",
  "feature-transform", "transform-translate", "transform-rotate", "transform-scale", "transform-copy", "transform-mirror", "transform-align",
  "feature-offset-face",
  "feature-face-extrude",
  "feature-shell",
  "feature-import-step", "feature-import-cad",   "feature-sheet-base", "feature-sheet-flange", "feature-sheet-hem", "feature-sheet-fold", "feature-sheet-unfold", "feature-sheet-refold", "sheet-export-flat-dxf", "show-configurations", "timeline-copy-features", "timeline-paste-features",
  "feature-surface-boundary", "feature-surface-blend", "feature-surface-untrim", "feature-surface-ruled", "feature-surface-extend", "feature-surface-extrude", "feature-surface-revolve", "feature-surface-loft", "feature-surface-patch", "feature-surface-sweep", "feature-surface-offset", "feature-surface-thicken", "feature-surface-stitch", "feature-surface-unstitch", "feature-surface-reverse-normal",
  "feature-hole", "feature-split", "feature-delete-face", "feature-pipe", "feature-bounding-solid", "feature-thread", "feature-coil", "feature-remove-body", "feature-boss", "feature-rest",
  "feature-loft",
  "feature-draft",
  "feature-boolean",
  "feature-pattern",
  "part-section",
  "part-properties",
  "part-interference", "part-clearance", "part-compare",
  "measure",
  "part-undo",
  "part-redo",
  "section-view",
  "engine-build",
  "new-part",
  "open-part",
  "save-part",
  "commit-part",
  "insert-step",
  "sketch",
  "rebuild-part",
  "connector",
  "fastened",
  "assembly-insert-component",
  "assembly-part-template", "assembly-from-json", "assembly-linear-array", "assembly-circular-array", "assembly-undo-recipe", "assembly-redo-recipe",
  "assembly-add-connector",
  "assembly-create-mate",
  "assembly-set-mate-dof-value",
  "assembly-edit-mate-dof-limits",
  "assembly-create-relation", "assembly-explode", "assembly-motion-study",
  "assembly-toggle-mate-suppressed",
  "assembly-remove-mate",
  "assembly-mate-fastened",
  "assembly-mate-revolute",
  "assembly-mate-cylindrical",
  "assembly-mate-prismatic",
  "assembly-mate-ball",
  "assembly-mate-distance",
  "assembly-mate-parallel",
  "assembly-mate-perpendicular",
  "assembly-mate-angle", "assembly-mate-planar", "assembly-mate-pin_slot",
  "assembly-mate-rack-pinion",
  "assembly-mate-screw",
  "assembly-mate-gears",
  "assembly-mate-belt",
  "assembly-solve",
  "assembly-toggle-grounded",
  "assembly-toggle-suppressed",
  "assembly-remove-instance",
  "fit-view",
  "clear-mates",
  "view-top",
  "view-bottom",
  "view-front",
  "view-back",
  "view-right",
  "view-left",
  "view-isometric",
  "display-shaded",
  "display-shaded-edges",
  "display-wireframe",
  "display-hidden-line",
  "display-ghost", "display-zebra", "display-draft-analysis", "display-curvature-map", "display-accessibility",
  "lighting-studio",
  "lighting-softbox",
  "lighting-daylight",
  "lighting-dark-room",
  "toggle-contact-shadows",
  "background-graphite",
  "background-midnight",
  "background-cad-light",
  "background-blueprint",
  "finish-matte",
  "finish-satin",
  "finish-gloss",
  "ground-none",
  "ground-grid",
  "ground-floor",
  "ground-both",
  "toggle-origin",
  "toggle-axes",
  "toggle-feature-edges",
  "reset-appearance",
  "selection-auto",
  "selection-component",
  "selection-body",
  "selection-face",
  "selection-edge",
  "selection-vertex",
  "selection-next-filter",
  "selection-directional", "selection-window", "selection-crossing", "selection-clear",
  "selection-freeform", "selection-paint",
  "selection-priority-body", "selection-priority-face", "selection-priority-edge",
];

const cadCommandIDSet: ReadonlySet<string> = new Set(cadCommandIDs);

export function isCADCommandID(value: string): value is CADCommandID {
  return cadCommandIDSet.has(value);
}

export class CADCommandRegistry {
  private handlers = new Map<CADCommandID, Handler>();
  private listeners = new Set<Listener>();
  private state: Readonly<Record<CADCommandID, CADCommandState>> =
    Object.freeze(
      Object.fromEntries(
        cadCommandIDs.map((id) => [
          id,
          Object.freeze({ enabled: true, active: false, registered: false }),
        ]),
      ) as Record<CADCommandID, CADCommandState>,
    );

  snapshot = (): Readonly<Record<CADCommandID, CADCommandState>> => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  register(id: CADCommandID, handler: Handler): () => void {
    this.handlers.set(id, handler);
    this.update(id, { registered: true });
    return () => {
      if (this.handlers.get(id) !== handler) return;
      this.handlers.delete(id);
      this.update(id, { registered: false, active: false });
    };
  }

  setEnabled(id: CADCommandID, enabled: boolean): void {
    this.update(id, { enabled });
  }

  setActive(id: CADCommandID, active: boolean): void {
    this.update(id, { active });
  }

  execute(id: CADCommandID): boolean {
    const command = this.state[id];
    const handler = this.handlers.get(id);
    if (!command.enabled || !handler) return false;
    void handler();
    return true;
  }

  private update(id: CADCommandID, patch: Partial<CADCommandState>): void {
    const current = this.state[id];
    const next = { ...current, ...patch };
    if (
      next.enabled === current.enabled &&
      next.active === current.active &&
      next.registered === current.registered
    ) return;
    this.state = Object.freeze({ ...this.state, [id]: Object.freeze(next) });
    this.listeners.forEach((listener) => listener());
  }
}

export const cadCommands = new CADCommandRegistry();
