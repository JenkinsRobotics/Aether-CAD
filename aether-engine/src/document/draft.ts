import type {SketchPlane} from '../sketch/index';

export interface DraftFeature {
  id: string;
  type: 'draft';
  name: string;
  suppressed: boolean;
  facePlane: {plane: SketchPlane; offsetMillimeters: number};
  neutralPlane: {plane: SketchPlane; offsetMillimeters: number};
  angleDegrees: number;
  reversed: boolean;
  targetBodyId?: string;
}

export function validateDraft(feature: DraftFeature): void {
  for (const reference of [feature.facePlane, feature.neutralPlane]) {
    if (!reference || !['XY','XZ','YZ'].includes(reference.plane) || !Number.isFinite(reference.offsetMillimeters))
      throw new Error('Draft needs finite face and neutral plane references.');
  }
  if (!Number.isFinite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees >= 90)
    throw new Error('Draft angle must be greater than 0 and less than 90 degrees.');
  if (typeof feature.reversed !== 'boolean') throw new Error('Invalid draft direction.');
}
