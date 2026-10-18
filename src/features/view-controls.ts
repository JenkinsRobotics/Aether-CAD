import type { FeatureWindow } from '@aether/ui';
import fitIcon from '@aether/assets/icons/tools/fit.svg?raw';
import { cadCommands } from '../cad-command-registry';

/** Optional viewport actions use the standard FeatureWindow footer in every editor. */
export function addFeatureViewControls(win: FeatureWindow, onFit = () => { cadCommands.execute('fit-view'); }) {
  win.actionIcon(fitIcon, 'Fit view', onFit);
}
