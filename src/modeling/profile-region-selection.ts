/** Persistent sketch selections shared by feature dialogs and agent commands.
 * Callers stage a candidate document and commit it only after exact rebuilding. */
import { identifySketchContour, resolveProfileDrawing, type PartDocument, type PartFeature, type SketchRegion } from '@aether/core/document';
import { regionBoundaryIdentity } from '@aether/core/sketch/reference/connected-sketch-regions';
import type { ProfileRegionSelection } from '@aether/core/sketch/reference/profile-region-reference';

export function stampSketchContour(doc: PartDocument, sketchId: string, index: number): string {
  const feature = doc.features.find(f => f.id === sketchId);
  if (feature?.type !== 'profile' || feature.profile.type === 'projection') throw Error('Pick a region on an authored sketch, not a projected one.');
  const drawing = resolveProfileDrawing(doc.features, sketchId);
  const contour = drawing.contours[index];
  if (!contour) throw Error('That sketch region is no longer there.');
  identifySketchContour(contour, () => crypto.randomUUID());
  delete drawing.pierceContext;
  feature.profile = drawing;
  return contour.id!;
}

export function stampResolvedProfileSelection(
  doc: PartDocument, feature: PartFeature, region: SketchRegion, identifyPrimitives = false,
): { profileFeatureId: string } & ProfileRegionSelection {
  if ((feature.type !== 'profile' && feature.type !== 'sketch') || feature.suppressed) throw Error('Select an available source sketch.');
  const base = { profileFeatureId: feature.id };
  if (feature.profile.type === 'projection') throw Error('Pick a region on an authored sketch, not a projected one.');
  if (feature.type === 'sketch' || (feature.profile.type !== 'drawing' && !identifyPrimitives)) return base;
  if (!region.sourceContourIndices) return { ...base, profileContourId: stampSketchContour(doc, feature.id, region.contourIndex) };
  if (region.ordinal !== undefined) throw Error('This region has ambiguous source boundaries. Add a divider or select a different region.');
  const drawing = resolveProfileDrawing(doc.features, feature.id);
  const identify = (index: number) => {
    const contour = drawing.contours[index];
    if (!contour) throw Error('A connected sketch region source is missing.');
    identifySketchContour(contour, () => crypto.randomUUID());
    return contour.id!;
  };
  const ids = region.sourceContourIndices.map(identify);
  const inside = region.insideContourIndices?.map(identify);
  const boundary = region.boundarySides ? regionBoundaryIdentity(drawing, region.boundarySides) : undefined;
  delete drawing.pierceContext;
  feature.profile = drawing;
  return { ...base, profileRegion: { contourIds: ids, ...(inside ? { inside } : {}), ...(boundary ? { boundary } : {}) } };
}
