import type { CADCommandID } from '../cad-command-registry';

/** Toolbar shortcuts initialize existing editors; saved features keep canonical types. */
export interface FeatureLaunchOptions {
  title?: string;
  initialOperation?: 'cut';
  initialTransform?: 'translate' | 'rotate' | 'scale' | 'copy' | 'mirror' | 'align';
  initialBooleanOperation?: 'union' | 'cut' | 'intersection';
  initialReplaceFace?: boolean;
}

export const featureToolbarPresets: ReadonlyArray<{
  command: CADCommandID;
  type: string;
  options: FeatureLaunchOptions;
}> = [
  { command: 'feature-union', type: 'boolean', options: { title: 'Union', initialBooleanOperation: 'union' } },
  { command: 'feature-subtract', type: 'boolean', options: { title: 'Subtract', initialBooleanOperation: 'cut' } },
  { command: 'feature-intersect', type: 'boolean', options: { title: 'Intersect', initialBooleanOperation: 'intersection' } },
  { command: 'feature-replace-face', type: 'offset-face', options: { title: 'Replace Face', initialReplaceFace: true } },
];
