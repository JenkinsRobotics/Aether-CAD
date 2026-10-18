/** Persisted contract for the native face-extrusion feature; no WASM evaluator. */
import {validatePlanarFaceAnchor, type PlanarFaceAnchor} from './planar-face-anchor';
export interface FaceExtrudeFeature {
  id: string;
  type: 'face-extrude';
  name: string;
  suppressed: boolean;
  sourceFeatureId: string;
  targetBodyId: string;
  normal: [number, number, number];
  faceAnchor?: PlanarFaceAnchor;
  faceLabel: string;
  distanceMillimeters: number;
}
export function validateFaceExtrude(feature: FaceExtrudeFeature, earlier: Map<string,string>, missingReference: (id:unknown)=>boolean): void {
  validatePlanarFaceAnchor(feature.faceAnchor);
  if (typeof feature.sourceFeatureId !== 'string' || !feature.sourceFeatureId.trim() || (!earlier.has(feature.sourceFeatureId) && !missingReference(feature.sourceFeatureId))) throw Error('Push/Pull needs an earlier source feature.');
  if (['profile','sketch','plane'].includes(earlier.get(feature.sourceFeatureId) ?? '')) throw Error('Push/Pull source must be a solid feature.');
  if (typeof feature.targetBodyId !== 'string' || !feature.targetBodyId.trim()) throw Error('Push/Pull needs a target body.');
  if (!Array.isArray(feature.normal) || feature.normal.length !== 3 || !feature.normal.every(Number.isFinite) || Math.abs(Math.hypot(...feature.normal)-1)>1e-6) throw Error('Push/Pull needs a valid planar face normal.');
  if (typeof feature.faceLabel !== 'string' || !feature.faceLabel.trim()) throw Error('Push/Pull needs a face label.');
  if (!Number.isFinite(feature.distanceMillimeters) || Math.abs(feature.distanceMillimeters)<1e-6) throw Error('Push/Pull distance must be finite and nonzero.');
}
