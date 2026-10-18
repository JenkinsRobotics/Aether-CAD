import { cadCommands } from '../cad-command-registry';
/** Regression helpers exercise public commands and attached, visible editors. */
export function showSketchEditor(editor) {
  if (!document.querySelector('.cad-sketch-workspace')) return;
  const command = { coordinates: 'sketch-coordinates', constraints: 'sketch-constraints', variables: 'sketch-variables', clipboard: 'sketch-clipboard' }[editor];
  if (command) cadCommands.execute(command);
  else {
    cadCommands.execute('sketch-coordinates');
    const picker = document.querySelector('[aria-label="Sketch editor"]');
    if (picker) { picker.value = editor; picker.dispatchEvent(new Event('change')); }
  }
}
export function querySketchControl(selector) {
  let result = document.querySelector(selector);
  if (result || !document.querySelector('.cad-sketch-workspace')) return result;
  let editor;
  if (/modification|fillet|chamfer|offset (edges|distance|selection|entities)|slot|mirror|pattern|move/i.test(selector) && !/value|data-constraint/.test(selector)) editor = "modify";
  else if (/X \(mm\)|Y \(mm\)|Polygon sides|Arc direction|Ellipse secondary|sketch-recent/.test(selector) && !/DXF|Text|Paste|Axis|Move/.test(selector)) editor = 'coordinates';
  else if (/text|font/i.test(selector)) editor = 'text';
  else if (/DXF|dxf-/.test(selector)) editor = 'import';
  else if (/Variable|variable/.test(selector)) editor = 'variables';
  else if (/Clipboard|Paste|clipboard/.test(selector)) editor = 'clipboard';
  else if (/aria-label|dimension-id|formula-dimension-id|sketch-constraints|dimension-link|data-constraint-id|data-constraint-kind/.test(selector)) editor = 'constraints';
  if (editor) { showSketchEditor(editor); result = document.querySelector(selector); }
  return result;
}
export function clickSketchControl(label) {
  const plane = { 'Top (XY)': 'XY', 'Front (XZ)': 'XZ', 'Right (YZ)': 'YZ' }[label];
  if (plane) { window.dispatchEvent(new CustomEvent('aether-sketch-plane', { detail: plane })); return; }
  if (label === 'Undo' || label === 'Redo') {
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: label === 'Redo', bubbles: true, cancelable: true })); return;
  }
  const accessibleName = label === 'Cancel' ? 'Cancel sketch' : label;
  const find = () => [...document.querySelectorAll('button')].find(b => (b.textContent === label || b.getAttribute('aria-label') === accessibleName) && !b.closest('[hidden]'));
  let button = find();
  if (!button) {
    const editor = /modification|chamfer|offset|slot/.test(label) ? 'modify' : /contour|Place point|spline|radius|ellipse size/i.test(label) ? 'coordinates'
      : /variable/i.test(label) ? 'variables' : /paste|copy/i.test(label) ? 'clipboard'
      : /text|font/i.test(label) ? 'text' : /DXF/.test(label) ? 'import' : 'constraints';
    showSketchEditor(editor); button = find();
  }
  if (!button) throw new Error(`Visible control not found: ${label}`);
  for (let parent = button.parentElement; parent; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true;
  button.click();
}

export function querySketchControls(selector) { querySketchControl(selector); return document.querySelectorAll(selector); }
