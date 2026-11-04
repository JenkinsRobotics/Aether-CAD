import type {SketchPlane} from '../sketch/index';
import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';
import {validateMirrorPlane, type MirrorPlaneReference} from './mirror-plane';
import {validateEdgeFinishEdge, type EdgeFinishEdge} from './solid-edge-reference';

export interface DraftFeature {
  id: string;
  type: 'draft';
  name: string;
  suppressed: boolean;
  /** Onshape's Neutral plane draft (default) or Parting line draft. */
  mode?: 'neutral' | 'parting-line';
  facePlane?: {plane: SketchPlane; offsetMillimeters: number};
  /** Picked planar faces; when present they replace the face plane. */
  faces?: SolidFaceReference[];
  neutralPlane?: {plane: SketchPlane; offsetMillimeters: number};
  /** A picked planar face as the neutral plane; when present it replaces neutralPlane. */
  neutralFace?: SolidFaceReference;
  /** Parting line: the pull direction is this plane's normal (a tree plane, a Plane feature or a planar face). */
  pullPlane?: MirrorPlaneReference;
  /** Parting line: the edges the faces pivot about; each stays where it is. */
  partingEdges?: EdgeFinishEdge[];
  /** Parting line: the face on the pull side of each edge (flip: the other), both sides by the same
   *  angle, or both with the second angle on the far side. */
  sides?: 'one' | 'symmetric' | 'two';
  secondAngleDegrees?: number;
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
  if (feature.mode === 'parting-line') {
    validateMirrorPlane(feature.pullPlane!, earlier, missing, 'Draft pull direction');
    if (!Array.isArray(feature.partingEdges) || !feature.partingEdges.length) throw new Error('Pick the parting edges.');
    for (const edge of feature.partingEdges) validateEdgeFinishEdge(edge, earlier, missing);
    if (feature.sides !== undefined && !['one','symmetric','two'].includes(feature.sides)) throw new Error('A parting line draft is one sided, symmetric or two sided.');
    if (feature.sides === 'two' ? !(Number.isFinite(feature.secondAngleDegrees) && feature.secondAngleDegrees! > 0 && feature.secondAngleDegrees! < 90) : feature.secondAngleDegrees !== undefined) throw new Error('A two sided draft needs a second angle between 0 and 90 degrees.');
  } else {
    if (feature.mode !== undefined && feature.mode !== 'neutral') throw new Error('Draft mode must be neutral or parting-line.');
    for (const reference of [feature.facePlane, feature.neutralPlane]) {
      if (!reference || !['XY','XZ','YZ'].includes(reference.plane) || !Number.isFinite(reference.offsetMillimeters))
        throw new Error('Draft needs finite face and neutral plane references.');
    }
  }

  if (!Number.isFinite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees >= 90)
    throw new Error('Draft angle must be greater than 0 and less than 90 degrees.');
  if (typeof feature.reversed !== 'boolean') throw new Error('Invalid draft direction.');
  if (feature.pullDirection !== undefined && !(Array.isArray(feature.pullDirection) && feature.pullDirection.length === 3 && feature.pullDirection.every(Number.isFinite) && Math.hypot(...feature.pullDirection) > 1e-9)) throw new Error('Draft pull direction must be a nonzero vector.');
}
