/** Agent picks are local sketch coordinates, resolved by the canvas picker.
 * Transient positions become persistent source-span references before rebuilding. */
import { resolveProfileDrawing, sketchRegions, type PartDocument, type PartFeature } from '@aether/core/document';
import { pickCurve, type SketchDrawing, type SketchPoint } from '@aether/core/sketch';
import { pickSketchRegion } from '../sketch/picking';
import { stampResolvedProfileSelection } from '../modeling/profile-region-selection';

export function selectionDrawing(doc: PartDocument, feature: PartFeature): SketchDrawing {
  if (feature.type === 'profile') return resolveProfileDrawing(doc.features, feature.id);
  if (feature.type !== 'sketch') throw Error('Select a sketch.');
  const p = feature.profile;
  const x = p.centerXMillimeters, y = p.centerYMillimeters, w = p.widthMillimeters / 2, h = p.heightMillimeters / 2;
  return { type: 'drawing', contours: [{ type: 'path', construction: p.construction, start: [x-w, y-h], segments: [[x+w,y-h],[x+w,y+h],[x-w,y+h],[x-w,y-h]].map(end => ({type:'line' as const,end:end as SketchPoint})) }] };
}

export function selectAgentProfileRegions(doc: PartDocument, featureId: string, point: unknown, all: unknown = false) {
  if (typeof all !== 'boolean') throw Error('all_regions must be true or false.');
  if (all && point !== undefined) throw Error('Choose profile_point_mm or all_regions, not both.');
  const feature = doc.features.find(f => f.id === featureId);
  if (!feature || feature.suppressed || !['profile','sketch'].includes(feature.type)) throw Error('Inspect the part and choose an unsuppressed sketch ID.');
  const regions = sketchRegions(feature, false, doc.features);
  if (!regions.length) throw Error('The sketch has no closed regions. Close its contours before extruding.');
  let selected = regions;
  if (point !== undefined) {
    if (!Array.isArray(point) || point.length !== 2 || point.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v)>1e6)) throw Error('profile_point_mm must contain two finite local coordinates within 1000000 mm.');
    const drawing = selectionDrawing(doc, feature), p = point as SketchPoint;
    const boundaries = {...drawing,contours:drawing.contours.filter(c=>!c.construction)};
    if (pickCurve(boundaries, p, Infinity).distance <= 1e-6) throw Error('Choose profile_point_mm strictly inside a region, away from its boundary.');
    const index = pickSketchRegion(drawing, p);
    selected = regions.filter(r => r.contourIndex === index);
    if (selected.length !== 1) throw Error('profile_point_mm is outside a selectable closed region.');
  } else if (!all && regions.length !== 1) {
    throw Error('The sketch has multiple closed regions. Inspect it and choose profile_point_mm, or explicitly set all_regions for Extrude.');
  }
  return selected.map(region => stampResolvedProfileSelection(doc, feature, region));
}
