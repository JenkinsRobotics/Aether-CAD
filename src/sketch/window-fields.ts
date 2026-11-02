import type { FeatureWindow } from '@aether/ui';
import { mountSketchPlaneControls } from './plane-controls';

/** The same sketch field composition is used by CAD and its Aether UI specimen.
 * The shared widget owns styling; callbacks belong to the host sketch editor. */
export function mountSketchWindowFields(win: FeatureWindow, options: {
  changePlane: () => void;
  onConstraintsChange: (checked: boolean) => void;
  onExpressionsChange: (checked: boolean) => void;
  onErrorsChange: (checked: boolean) => void;
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
  // No "project face edges on start" and no "flip sketch plane" (Jonathan, 2026-11-01): projecting is the
  // Project tool's job, and a saved flip still loads from the document.
  return plane;
}
