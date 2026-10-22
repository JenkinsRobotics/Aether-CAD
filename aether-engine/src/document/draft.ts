import type {SketchPlane} from '../sketch/index';
import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';

export interface DraftFeature {
  id: string;
  type: 'draft';
  name: string;
  suppressed: boolean;
  facePlane: {plane: SketchPlane; offsetMillimeters: number};
  /** Picked planar faces; when present they replace the face plane. */
  faces?: SolidFaceReference[];
  neutralPlane: {plane: SketchPlane; offsetMillimeters: number};
  /** A picked planar face as the neutral plane; when present it replaces neutralPlane. */
  neutralFace?: SolidFaceReference;
  angleDegrees: number;
  reversed: boolean;
  /** The pull (mould opening) direction; default: the neutral plane's normal. */
  pullDirection?: [number, number, number];
  targetBodyId?: string;
}

export function validateDraft(feature: DraftFeature, earlier: ReadonlyMap<string,string> = new Map(), missing: (id: string) => boolean = () => false): void {
  if (feature.neutralFace !== undefined) { validateSolidFaceReference(feature.neutralFace, earlier, missing, 'Draft neutral face'); if (feature.neutralFace.surfaceType) throw new Error('The neutral face must be planar.'); }
  if (feature.faces !== undefined) {
    if (!Array.isArray(feature.faces) || !feature.faces.length) throw new Error('Pick at least one face to draft.');
    for (const face of feature.faces) { validateSolidFaceReference(face, earlier, missing, 'Draft face'); if (face.surfaceType) throw new Error('Draft needs planar faces.'); }
  }
  for (const reference of [feature.facePlane, feature.neutralPlane]) {
    if (!reference || !['XY','XZ','YZ'].includes(reference.plane) || !Number.isFinite(reference.offsetMillimeters))
      throw new Error('Draft needs finite face and neutral plane references.');
  }
  if (!Number.isFinite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees >= 90)
    throw new Error('Draft angle must be greater than 0 and less than 90 degrees.');
  if (typeof feature.reversed !== 'boolean') throw new Error('Invalid draft direction.');
  if (feature.pullDirection !== undefined && !(Array.isArray(feature.pullDirection) && feature.pullDirection.length === 3 && feature.pullDirection.every(Number.isFinite) && Math.hypot(...feature.pullDirection) > 1e-9)) throw new Error('Draft pull direction must be a nonzero vector.');
}
