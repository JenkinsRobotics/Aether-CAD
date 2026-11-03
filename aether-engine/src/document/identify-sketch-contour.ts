import { contourClosed, type SketchContour } from "../sketch/drawing";

/** Mutates only a candidate contour; callers own the atomic document commit. */
export function identifySketchContour(
  contour: SketchContour,
  createId: () => string,
): void {
  contour.id ??= createId();
  if (contour.type !== "path") return;
  contour.startVertexId ??= createId();
  contour.segments.forEach((segment, index) => {
    segment.id ??= createId();
    segment.endVertexId ??=
      index === contour.segments.length - 1 && contourClosed(contour)
        ? contour.startVertexId
        : createId();
  });
}

/** Every contour and segment of every drawn sketch carries an identity, so lines, points and
 *  regions can be referenced by later features (Jonathan, 2026-11-02: a drawn construction line
 *  with no segment id could not be a revolve axis). Sketches already identified are untouched. */
export function identifyDocumentSketches(document: { features: readonly unknown[] }): void {
  for (const feature of document.features as { id: string; type?: string; profile?: { type?: string; contours?: SketchContour[] } }[]) {
    if (feature.type !== "profile" || feature.profile?.type !== "drawing") continue;
    // Deterministic ids (sketch, contour position, running number): an undo snapshot taken
    // before stamping re-stamps to the same ids, so references made afterwards still resolve.
    (feature.profile.contours ?? []).forEach((contour, index) => { let n = 0; identifySketchContour(contour, () => `${feature.id}-c${index}-${n++}`); });
  }
}
