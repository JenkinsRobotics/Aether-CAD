/** Sketch feature editor — window layout, controls, and validation. */
import { demoWindow } from "./shared";
import { mountSketchWindowFields } from '../../src/sketch/window-fields';
import { addSketchNormalControl } from '../../src/modeling/sketch-normal-control';

export const buildSketchDemo = (host: HTMLElement) => {
  const win = demoWindow(host, 'Sketch 6', 'Apply sketch');
  addSketchNormalControl(win);
  const fields = mountSketchWindowFields(win, {
    changePlane: () => { fields.render(); win.setError('Select a sketch plane.'); },
    onConstraintsChange: checked => { win.panel.dataset.showConstraints = String(checked); },
    onExpressionsChange: checked => { win.panel.dataset.showExpressions = String(checked); },
    onErrorsChange: checked => { win.panel.dataset.showErrors = String(checked); },
  });
  fields.render('Top Plane');
  return win;
};
