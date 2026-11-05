import type { SketchLineDirectionReference } from './part-document';
import { validateSolidEdgeReference, type SolidEdgeReference } from './solid-edge-reference';
import { validateSolidFaceReference, type SolidFaceReference } from './solid-face-reference';

/** Persistent direction; geometry is resolved at the source history position. */
export type ExtrusionDirectionReference = SketchLineDirectionReference | SolidEdgeReference |
  (SolidFaceReference & { kind: 'face-axis'; surfaceType: 'cylinder' | 'cone' }) |
  { kind: 'axis'; sourceFeatureId: string; label: string };

export function validateExtrusionDirectionReference(ref: ExtrusionDirectionReference,
  earlier: ReadonlyMap<string, string>, missing: (id: string) => boolean): void {
  const id = (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= 128;
  if (!ref || typeof ref !== 'object') throw Error('Select an extrusion direction reference.');
  if (ref.kind === 'solid-edge') { validateSolidEdgeReference(ref, earlier, missing); return; }
  if (ref.kind === 'face-axis') {
    validateSolidFaceReference(ref, earlier, missing, 'Extrusion axis');
    if (ref.surfaceType === 'cylinder' || ref.surfaceType === 'cone') return;
    throw Error('Extrusion axis needs a cylindrical or conical face.');
  }
  if (ref.kind === 'sketch-line') {
    if ([ref.sourceFeatureId, ref.contourId, ref.segmentId].every(id) &&
      (missing(ref.sourceFeatureId) || earlier.get(ref.sourceFeatureId) === 'profile')) return;
  } else if (ref.kind === 'axis') {
    if (id(ref.sourceFeatureId) && typeof ref.label === 'string' && !!ref.label.trim() && ref.label.length <= 512 &&
      (missing(ref.sourceFeatureId) || earlier.get(ref.sourceFeatureId) === 'axis')) return;
  }
  throw Error('Extrusion direction needs an earlier sketch line, native straight edge, cylindrical or conical face, or construction axis.');
}
