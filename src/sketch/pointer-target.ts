import type { SketchDrawing, SketchEntityRef, SketchPoint } from "@aether/core/sketch";
import { pickSketchEditEntity } from "./edit-picking";
import { pickSelectableSketchEntity } from "./projected-picking";

/** The one answer to "what is under the pointer" (Jonathan, 2026-11-02): hover highlights it,
 *  a click selects it, a press drags it, and a box selection never starts over it. One hit
 *  test, one tolerance, shared by every sketch pointer gesture. */
export type PointerTarget = NonNullable<ReturnType<typeof pickSketchEditEntity>>;
export function createPointerTarget(o: {
  svg: SVGSVGElement;
  drawing(): SketchDrawing;
  tolerance(): number;
  /** Editing picks include ellipse and conic handles; other tools pick geometry only. */
  editing(): boolean;
}) {
  let current: PointerTarget | null = null;
  return {
    update(point: SketchPoint | null): PointerTarget | null {
      const pick = point ? (o.editing() ? pickSketchEditEntity(o.drawing(), point, o.svg) : pickSelectableSketchEntity(o.drawing(), point)) : undefined;
      current = pick && pick.d < o.tolerance() ? pick : null;
      return current;
    },
    current: () => current,
    ref: (): SketchEntityRef | null => current?.ref ?? null,
    clear() { current = null; },
  };
}
