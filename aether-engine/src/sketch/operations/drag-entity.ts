import {
  contourClosed,
  validateSketchDrawing,
  type SketchDrawing,
  type SketchPoint,
} from "../drawing";
import {
  sketchEntityPoint,
  solveDrawingConstraints,
  type SketchEntityRef,
  type DrawingConstraint,
} from "../drawing-constraints";
import { translateRetainedTextForDrag } from "../text/drag";
import { prepareSplineEndDrag } from "../reference/spline-end-tangents";
/** Solve a pointer move with temporary point targets; no drag constraints are persisted. */
/** Drag as far as the constraints allow: the full pointer delta first, then the
 * largest feasible fraction of it, and the unchanged drawing when nothing can move
 * (Jonathan, 2026-11-01: a free entity must follow the pointer, a bound one stays put,
 * neither is an error). ponytail: bisection over the delta, not a weighted solve. */
export function dragSketchEntity(
  source: SketchDrawing,
  ref: SketchEntityRef,
  delta: SketchPoint,
): SketchDrawing {
  if (!delta.every(Number.isFinite))
    throw new Error("Pointer movement must be finite.");
  try { return dragSketchEntityExactly(source, ref, delta); } catch (error) {
    if (!(error instanceof Error) || /must be finite|Select existing|Select an existing|cannot be moved/.test(error.message)) throw error;
  }
  const along = (direction: SketchPoint): { drawing: SketchDrawing; fraction: number } | null => {
    try { return { drawing: dragSketchEntityExactly(source, ref, direction), fraction: 1 }; } catch { /* bisect below */ }
    let low = 0, high = 1, best: SketchDrawing | null = null;
    for (let step = 0; step < 6; step++) {
      const mid = (low + high) / 2;
      try { best = dragSketchEntityExactly(source, ref, [direction[0] * mid, direction[1] * mid]); low = mid; }
      catch { high = mid; }
    }
    return best ? { drawing: best, fraction: low } : null;
  };
  // The full delta first; then, when the constraints forbid that direction (a horizontal line's
  // free end dragged diagonally), the larger feasible axis component, so the point still follows
  // the pointer as far as the sketch allows (Jonathan, 2026-11-02).
  const whole = along(delta);
  if (whole?.fraction === 1) return whole.drawing;
  const candidates = [whole, along([delta[0], 0]), along([0, delta[1]])]
    .map((item, i) => item && { ...item, reach: item.fraction * (i === 0 ? Math.hypot(...delta) : Math.abs(delta[i - 1])) })
    .filter((item): item is NonNullable<typeof item> => !!item && item.reach > 1e-9)
    .sort((a, b) => b.reach - a.reach);
  return candidates[0]?.drawing ?? source;
}
function dragSketchEntityExactly(
  source: SketchDrawing,
  ref: SketchEntityRef,
  delta: SketchPoint,
): SketchDrawing {
  const splineDrag = prepareSplineEndDrag(source, ref);
  source = splineDrag?.drawing ?? source;
  const next = structuredClone(source);
  const retainedText = translateRetainedTextForDrag(next, ref.contour, delta);
  const path = next.contours[ref.contour];
  if (!path) throw new Error("Select existing geometry.");
  const refs: SketchEntityRef[] =
    ref.kind === "point"
      ? [ref]
      : path.type === "circle"
        ? [{ contour: ref.contour, kind: "point", index: 0 }]
        : [
            { contour: ref.contour, kind: "point", index: ref.index! },
            { contour: ref.contour, kind: "point", index: ref.index! + 1 },
          ];
  if (path.type === "path" && ref.kind !== "point") {
    const segment = path.segments[ref.index!];
    if (!segment) throw new Error("Select an existing segment.");
    if (segment.type === 'conic') refs.push({contour:ref.contour,kind:'point',index:ref.index,control:0});
    if (segment.type === "bezier")
      refs.push(
        ...([0, 1] as const).map((control) => ({
          contour: ref.contour,
          kind: "point" as const,
          index: ref.index,
          control,
        })),
      );
    if (segment.type === "arc" && !retainedText)
      segment.middle = [
        segment.middle[0] + delta[0],
        segment.middle[1] + delta[1],
      ];
  }
  const used = new Set(next.constraints?.map((c) => c.id)),
    targets: DrawingConstraint[] = [];
  for (const [i, r] of refs.entries()) {
    const old = sketchEntityPoint(source, r),
      p = sketchEntityPoint(next, r);
    if (!old || !p) throw new Error("The selected entity cannot be moved.");
    const target: SketchPoint = [old[0] + delta[0], old[1] + delta[1]];
    p[0] = target[0];
    p[1] = target[1];
    if (
      path.type === "path" &&
      r.control === undefined &&
      contourClosed(source.contours[ref.contour]) &&
      (r.index === 0 || r.index === path.segments.length)
    ) {
      path.start = [...target];
      path.segments.at(-1)!.end = [...target];
    }
    let id = `drag-target-${i}`;
    while (used.has(id)) id += "-";
    used.add(id);
    targets.push({ id, kind: "fix", a: r, point: target });
  }
  next.constraints = [...(next.constraints ?? []), ...targets];
  const solved = solveDrawingConstraints(next);
  const temporaryIds = new Set(targets.map((c) => c.id));
  solved.constraints =
    source.constraints === undefined
      ? undefined
      : solved.constraints?.filter((c) => !temporaryIds.has(c.id) && !splineDrag?.temporaryIds.has(c.id));
  validateSketchDrawing(solved);
  return solved;
}
