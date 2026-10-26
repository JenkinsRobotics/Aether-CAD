/** Display-only inspection tools. Exact values come from the CAD engine/viewer. */
import { createRoot } from 'react-dom/client';
import { openCompactFeatureWindow } from '@aether/ui';
import { unitCatalog, unitChoice } from '@aether/core/units';
import type { PartDocument } from '@aether/core/document';
import { type CADSelectionFilter } from '../cad-selection-store';
import { documentUnits } from '../document-preferences';
import { MeasureResults, type MeasureType } from './MeasureResults';
import { MEASUREMENT_MODES, type MeasurementMode } from './measurement-geometry';
import { mountMeasurementOverlay } from './measurement-overlay';
import './measure-window.css';
import { createInspectionSession } from '../inspection/inspection-session';

const UNIT_NAMES: Record<string, string> = { mm: 'Millimeter', cm: 'Centimeter', m: 'Meter', in: 'Inch', ft: 'Foot', deg: 'Degree', rad: 'Radian' };
const named = (family: 'length' | 'angle') => Object.keys(unitCatalog[family].options).map(unit => UNIT_NAMES[unit] ?? unit);
const unitFor = (name: string) => Object.keys(UNIT_NAMES).find(unit => UNIT_NAMES[unit] === name) ?? name;
const FILTERS: Record<string, CADSelectionFilter> = { Automatic: 'auto', Bodies: 'body', Faces: 'face', Edges: 'edge', Vertices: 'vertex' };
let closeOpen: (() => void) | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());
export const measureWindowOpen = () => closeOpen !== null;
export const subscribeMeasureWindow = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function toggleMeasureWindow(currentPart: () => PartDocument | null): void {
  if (closeOpen) { closeOpen(); return; }
  const session = createInspectionSession({ inheritSelection: true, changed: active => {
    window.dispatchEvent(new CustomEvent('aether-measure-picking', { detail: { active, points: active && mode.value() !== 'Objects' } }));
    entities.element.dataset.active = String(active);
  } });
  const previousFilter = session.selection.snapshot().filter;
  const viewport = document.querySelector<HTMLElement>('.cad-studio-viewport') ?? document.body;
  const overlay = mountMeasurementOverlay(viewport);
  const close = (clear = false) => {
    if (!closeOpen) return;
    closeOpen = null;
    if (clear) session.selection.dispatch({ type: 'clear' });
    window.dispatchEvent(new CustomEvent('aether-measure-picking', { detail: { active: false, points: false } }));
    session.dispose();
    window.removeEventListener('keydown', escape);
    root.unmount(); overlay.dispose(); win.close(); changed();
  };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && win.isFrontmost()) { event.preventDefault(); close(true); } };
  const win = openCompactFeatureWindow({ className: 'cad-measure-window', viewport, title: 'Measure', icon: 'measure', acceptLabel: 'Done', onAccept: () => close(), onDiscard: () => close(true) });
  win.addHelp('Objects: select bodies, faces, edges or vertices to measure their properties and spacing.');
  win.addHelp('Point-to-point: pick two snap points. Hover over a face to reveal corners, midpoints and centers. Click a selected point again to remove it.');
  win.addHelp('3-point angle: pick three snap points. The second point is the angle vertex.');
  const selection = win.section('Measurement');
  const mode = win.picker(MEASUREMENT_MODES, { ariaLabel: 'Measurement mode', onChange: () => {
    session.selection.dispatch({ type: 'clear' });
    syncFilter(); render();
  } });
  selection.body.append(win.row('Mode', mode.element));
  const entities = win.entitiesBox('Select entities to measure');
  selection.body.append(entities.element);
  const filters = win.picker(Object.keys(FILTERS), { value: Object.keys(FILTERS).find(key => FILTERS[key] === previousFilter) ?? 'Automatic', ariaLabel: 'Measure selection', onChange: () => { syncFilter(); } });
  const filterRow = win.row('Select', filters.element); selection.body.append(filterRow);
  const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'aui-button aui-button--flat'; clear.textContent = 'Clear selection';
  clear.onclick = () => session.selection.dispatch({ type: 'clear' }); selection.body.append(clear);
  const display = win.section('Display');
  const type = win.picker(['Show all', 'Minimum', 'Center'], { value: 'Show all', ariaLabel: 'Measure type', onChange: () => render() });
  const typeRow = win.row('Distances', type.element); display.body.append(typeRow);
  const units = documentUnits();
  const length = win.picker(named('length'), { value: UNIT_NAMES[unitChoice(units, 'length').unit], ariaLabel: 'Length unit', onChange: () => render() });
  const angle = win.picker(named('angle'), { value: UNIT_NAMES[unitChoice(units, 'angle').unit], ariaLabel: 'Angle unit', onChange: () => render() });
  const lengthRow = win.row('Length unit', length.element), angleRow = win.row('Angle unit', angle.element);
  display.body.append(lengthRow, angleRow);
  const host = document.createElement('div'); host.className = 'cad-measure-results'; win.body.append(host);
  const root = createRoot(host);
  const syncFilter = () => {
    const points = mode.value() !== 'Objects';
    session.selection.dispatch({ type: 'set-filter', filter: points ? 'vertex' : FILTERS[filters.value()] });
    window.dispatchEvent(new CustomEvent('aether-measure-picking', { detail: { active: session.active(), points: session.active() && points } }));
  };
  const render = () => {
    const objects = mode.value() === 'Objects'; filterRow.hidden = typeRow.hidden = !objects;
    lengthRow.hidden = mode.value() === '3-point angle';
    angleRow.hidden = mode.value() === 'Point-to-point';
    root.render(<MeasureResults selection={session.selection} currentPart={currentPart} entities={entities} type={type.value() as MeasureType}
      lengthUnit={unitFor(length.value())} angleUnit={unitFor(angle.value())} mode={mode.value() as MeasurementMode} annotate={overlay.set}/>);
  };
  closeOpen = () => close();
  window.addEventListener('keydown', escape);
  session.attach(win);
  entities.element.addEventListener('click', () => session.activate());
  syncFilter(); render(); changed();
}
