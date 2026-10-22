import type { FeatureWindow } from '@aether/ui';
import { mountSketchPlaneControls } from './plane-controls';

/** The same sketch field composition is used by CAD and its Aether UI specimen.
 * The shared widget owns styling; callbacks belong to the host sketch editor. */
export function mountSketchWindowFields(win: FeatureWindow, options: {
  changePlane: () => void;
  onConstraintsChange: (checked: boolean) => void;
  onExpressionsChange: (checked: boolean) => void;
  onErrorsChange: (checked: boolean) => void;
  onProjectEdgesChange?: (checked: boolean) => void;
  /** SolidCraft's `flip`: a half turn of the sketch plane about its x axis. */
  onFlipChange?: (checked: boolean) => void;
  flipped?: boolean;
}) {
  const plane = mountSketchPlaneControls(win, options.changePlane);
  const checkbox = (label: string, checked: boolean, onChange?: (checked: boolean) => void) => {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', label);
    input.disabled = !onChange;
    if (onChange) input.onchange = () => onChange(input.checked);
    else input.title = 'Not available yet.';
    win.row(label, input);
  };
  checkbox('Disable imprinting', false);
  checkbox('Show constraints', true, options.onConstraintsChange);
  checkbox('Show expressions', false, options.onExpressionsChange);
  checkbox('Show errors', true, options.onErrorsChange);
  if (options.onProjectEdgesChange) checkbox('Project face edges on start', false, options.onProjectEdgesChange);
  if (options.onFlipChange) checkbox('Flip sketch plane', options.flipped ?? false, options.onFlipChange);
  return plane;
}
