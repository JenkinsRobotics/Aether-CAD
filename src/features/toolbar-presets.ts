import type { CADCommandID } from '../cad-command-registry';

/** Toolbar shortcuts initialize existing editors; saved features keep canonical types. */
export interface FeatureLaunchOptions {
  title?: string;
  initialOperation?: 'cut';
  initialTransform?: 'translate' | 'rotate' | 'scale' | 'copy' | 'mirror' | 'align';
  initialReplaceFace?: boolean;
}

export const featureToolbarPresets: ReadonlyArray<{
  command: CADCommandID;
  type: string;
  options: FeatureLaunchOptions;
}> = [
  { command: 'feature-replace-face', type: 'offset-face', options: { title: 'Replace Face', initialReplaceFace: true } },
];
