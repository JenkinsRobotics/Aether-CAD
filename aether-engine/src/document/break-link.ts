import type { PartDocument, PartFeature } from "./part-document";
import { validatePartDocument } from "./part-document";
import { resolveProfileDrawing } from "./profile-projection";
import type { SketchEntityRef } from "../sketch/solver/types";

/** Break Link (SolidCraft's sketch.break_link): a projected sketch becomes an ordinary drawing.
 *  The projected curves stay where they are as normal, free geometry; the sketch's own curves
 *  and relations follow, with every reference to a projected curve (by its id) turned into a
 *  plain contour index. Later edits to the source no longer reach it. */
export function breakProjectionLink(doc: PartDocument, featureId: string): PartDocument {
  const index = doc.features.findIndex((f) => f.id === featureId), feature = doc.features[index];
  if (!feature || feature.type !== "profile" || feature.profile.type !== "projection") throw new Error("Break Link works on a projected sketch.");
  const withoutAuthored = doc.features.map((f) => (f.id === featureId && f.type === "profile" && f.profile.type === "projection" ? { ...f, suppressed: false, profile: { ...f.profile, authored: undefined } } : f)) as PartFeature[];
  const projected = resolveProfileDrawing(withoutAuthored, featureId);
  const authored = structuredClone(feature.profile.authored ?? { type: "drawing" as const, contours: [] });
  const offset = projected.contours.length;
  const remap = (ref: SketchEntityRef): SketchEntityRef => {
    if (ref.projectedContourId !== undefined) {
      const at = projected.contours.findIndex((c) => c.id === ref.projectedContourId);
      if (at < 0) throw new Error(`A relation names projected curve ${ref.projectedContourId}, which the source no longer has.`);
      const { projectedContourId: _gone, ...rest } = ref;
      return { ...rest, contour: at };
    }
    return { ...ref, contour: ref.contour + offset };
  };
  const constraints = (authored.constraints ?? []).map((c) => ({ ...c, a: remap(c.a), ...(c.b ? { b: remap(c.b) } : {}), ...(c.axis ? { axis: remap(c.axis) } : {}) }));
  // Geometry as the sketch shows it now (the authored curves solved against the projection), so
  // the relations already hold once the projected curves become free.
  const shown = resolveProfileDrawing(doc.features.map((f) => (f.id === featureId ? { ...f, suppressed: false } : f)) as PartFeature[], featureId);
  if (shown.contours.length !== offset + authored.contours.length) throw new Error("The projected sketch could not be resolved for Break Link.");
  const drawing = { ...authored, type: "drawing" as const, contours: structuredClone(shown.contours), ...(constraints.length ? { constraints } : {}) };
  delete (drawing as { projectionContext?: unknown }).projectionContext;
  delete (drawing as { pierceContext?: unknown }).pierceContext;
  if (!constraints.length) delete (drawing as { constraints?: unknown }).constraints;
  const next = structuredClone(doc);
  next.features[index] = { ...feature, profile: drawing } as PartFeature;
  validatePartDocument(next);
  return next;
}
