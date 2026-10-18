import type { DocumentVariable,ProfileFeature } from "@aether/core/document";
import type { SketchDrawing, SketchPoint } from "@aether/core/sketch";
export interface SketchSnapshot {
  drawing: SketchDrawing;
  variables?: DocumentVariable[];
  activePath: number;
  dimensionPositions?: Record<string, SketchPoint>;
  /** Source identity changes staged by external constraints, committed together
   * with the drawing and restored by the same undo/cancel transaction. */
  sourceProfiles?: ProfileFeature[];
}

/** Undo restores the active path as well as geometry, so drawing can continue. */
export function createSketchHistory() {
  const undo: SketchSnapshot[] = [],
    redo: SketchSnapshot[] = [];
  return {
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    checkpoint(current: SketchSnapshot) {
      undo.push(structuredClone(current));
      redo.length = 0;
    },
    undo(current: SketchSnapshot) {
      const previous = undo.pop();
      if (previous) redo.push(structuredClone(current));
      return previous;
    },
    redo(current: SketchSnapshot) {
      const next = redo.pop();
      if (next) undo.push(structuredClone(current));
      return next;
    },
  };
}
