import { createRequire } from 'node:module';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const analyzePart = vi.fn();
vi.mock('../modeling/part-analysis', () => ({ analyzePart: (...args) => analyzePart(...args) }));
let dom, toggleMeasureWindow, measureWindowOpen, cadSelection, applyDocumentUnits, geometry, picking;
const part = { name: 'Plate' };
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/cad/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
  ({ toggleMeasureWindow, measureWindowOpen } = await import('./MeasureWindow'));
  ({ cadSelection } = await import('../cad-selection-store'));
  ({ applyDocumentUnits } = await import('../document-preferences'));
  window.addEventListener('aether-plane-geometry-request', () => window.dispatchEvent(new CustomEvent('aether-plane-geometry', { detail: geometry })));
  window.addEventListener('aether-measure-picking', event => { picking = event.detail; });
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  geometry = { points: [], measurements: [] }; analyzePart.mockReset();
  await act(async () => { applyDocumentUnits({ length: { unit: 'in', decimals: 3 }, angle: { unit: 'deg', decimals: 2 } }); toggleMeasureWindow(() => part); });
});
afterEach(async () => { await act(async () => { if (measureWindowOpen()) toggleMeasureWindow(() => part); cadSelection.dispatch({ type: 'clear' }); }); });
const select = items => act(async () => cadSelection.dispatch({ type: 'replace', items }));
const results = () => document.querySelector('[aria-label="Measurements"]').textContent;
const choose = async (label, option) => {
  await act(async () => document.querySelector(`[aria-label="${label}"]`).click());
  await act(async () => [...document.querySelectorAll('[role="option"]')].find(item => item.textContent === option).click());
};

it('opens the standard compact window (icon, Cancel and Done), condensed until something is measured', async () => {
  const win = document.querySelector('.cad-measure-window');
  expect(win.querySelector('.aui-float-panel-title').textContent).toBe('Measure');
  expect([...win.querySelectorAll('.aui-feature-commit-actions button')].map(button => button.textContent)).toEqual(['Cancel', 'Done']);
  expect(win.querySelector('.aui-feature-header-icon svg')).toBeTruthy();
  // No invented results before a pick; explain the next step.
  expect(win.querySelector('[aria-label="Measurements"]')).toBeNull();
  expect(win.querySelector('.cad-measure-results').textContent).toContain('Select bodies');
  expect(win.querySelector('[aria-label="Select entities to measure"]')).toBeTruthy();
  expect(picking).toEqual({ active: true, points: false });
  await select([{ id: 'face:p:1', kind: 'face', partId: 'p', label: 'Face 1 of Plate', faceId: 1 }]);
  expect(win.textContent).toContain('Face 1 of Plate');
  // Removing it from the window deselects it in the model.
  await act(async () => win.querySelector('[aria-label="Remove Face 1 of Plate"]').click());
  expect(cadSelection.snapshot().items).toEqual([]);
  await act(async () => [...win.querySelectorAll('.aui-feature-commit-actions button')].find(b => b.textContent === 'Done').click());
  expect(document.querySelector('.cad-measure-window')).toBeNull();
  expect(picking).toEqual({ active: false, points: false });
  // Cancel closes too, and drops what was picked.
  await act(async () => toggleMeasureWindow(() => part));
  await select([{ id: 'face:p:1', kind: 'face', partId: 'p', label: 'Face 1 of Plate', faceId: 1 }]);
  await act(async () => [...document.querySelectorAll('.cad-measure-window .aui-feature-commit-actions button')].find(b => b.textContent === 'Cancel').click());
  expect(document.querySelector('.cad-measure-window')).toBeNull();
  expect(cadSelection.snapshot().items).toEqual([]);
});

it('measures exact minimum distance through the engine with the selected entity references', async () => {
  analyzePart.mockResolvedValue({ measurements: [{ distance_mm: 15, points: [[10, 0, 0], [25, 0, 0]] }] });
  await select([{ id: 'face:a:7', kind: 'face', partId: 'a', label: 'Face A', faceId: 7 }, { id: 'edge:b:face--3-edge-2', kind: 'edge', partId: 'b', label: 'Edge B' }]);
  expect(analyzePart).toHaveBeenCalledWith(part, { kind: 'distance', entities: [{ body_id: 'a', face_id: 7 }, { body_id: 'b', face_id: -3, edge_index: 2 }] }, expect.anything());
  expect(results()).toContain('Minimum distance');
  expect(results()).toContain('0.591 in');
  await choose('Length unit', 'Millimeter');
  expect(results()).toContain('15.000 mm');
});

it('shows center spacing, radius and length of circular edges, and filters by measure type', async () => {
  geometry = { points: [], measurements: [
    { id: 'a', kind: 'edge', label: 'Circle A', lengthMillimeters: 50.8, radiusMillimeters: 12.7, centerMillimeters: [0, 0, 0] },
    { id: 'b', kind: 'edge', label: 'Circle B', lengthMillimeters: 50.8, radiusMillimeters: 12.7, centerMillimeters: [25.4, 0, 0] }] };
  await select([{ id: 'a', partId: 'part', kind: 'edge', label: 'A' }, { id: 'b', partId: 'part', kind: 'edge', label: 'B' }]);
  expect(results()).toContain('Center distance'); expect(results()).toContain('1.000 in');
  expect(results()).toContain('Radius'); expect(results()).toContain('0.500 in');
  expect(results()).toContain('Length'); expect(results()).toContain('2.000 in');
  await choose('Measure type', 'Center');
  expect(results()).toContain('Center distance'); expect(results()).not.toContain('Radius');
});

it('shows vertex positions and their spacing', async () => {
  geometry = { points: [{ partId: 'p', candidateId: 'v1', positionMillimeters: [25.4, -50.8, 0] }, { partId: 'p', candidateId: 'v2', positionMillimeters: [50.8, -50.8, 0] }], measurements: [] };
  await select([{ id: 'vertex:p:v1', partId: 'p', kind: 'vertex', label: 'Vertex 1' }]);
  expect(results()).toContain('1.000 in'); expect(results()).toContain('-2.000 in');
  await select([{ id: 'vertex:p:v1', partId: 'p', kind: 'vertex', label: 'Vertex 1' }, { id: 'vertex:p:v2', partId: 'p', kind: 'vertex', label: 'Vertex 2' }]);
  expect(results()).toContain('Center distance'); expect(results()).toContain('ΔX');
});

it('shows the angle between straight edges in the chosen unit and drops it when the geometry changes', async () => {
  geometry = { points: [], measurements: [{ id: 'a', label: 'A', kind: 'edge', linearDirection: [1, 0, 0] }, { id: 'b', label: 'B', kind: 'edge', linearDirection: [1, 1, 0] }] };
  await select([{ id: 'a', partId: 'part', kind: 'edge', label: 'A' }, { id: 'b', partId: 'part', kind: 'edge', label: 'B' }]);
  expect(results()).toContain('Angle between straight edges'); expect(results()).toContain('45.00 deg');
  await choose('Angle unit', 'Radian');
  expect(results()).toContain('0.79 rad');
  geometry = { points: [], measurements: [{ id: 'a', label: 'A', kind: 'edge', linearDirection: [1, 0, 0] }, { id: 'b', label: 'Arc', kind: 'edge', radiusMillimeters: 5 }] };
  await act(async () => window.dispatchEvent(new Event('aether-part-updated')));
  expect(results()).not.toContain('Angle between');
});


it('point and angle modes use exact world points, explicit units, clear, and restore the previous selection filter', async () => {
  await choose('Measurement mode', 'Point-to-point');
  expect(cadSelection.snapshot().filter).toBe('vertex');
  geometry = { points: [
    { candidateId: 'v1', partId: 'p', positionMillimeters: [25.4, 0, 0] },
    { candidateId: 'v2', partId: 'p', positionMillimeters: [0, 0, 0] },
    { candidateId: 'v3', partId: 'p', positionMillimeters: [0, 25.4, 0] },
  ], measurements: [] };
  const vertices = [1, 2, 3].map(n => ({ id: `vertex:p:v${n}`, partId: 'p', kind: 'vertex', label: `Vertex ${n}` }));
  await select(vertices.slice(0, 2));
  expect(results()).toContain('Point-to-point distance'); expect(results()).toContain('1.000 in');
  expect(analyzePart).not.toHaveBeenCalled();
  await choose('Measurement mode', '3-point angle');
  expect(cadSelection.snapshot().items).toEqual([]);
  await select(vertices);
  expect(results()).toContain('90.00 deg');
  await choose('Angle unit', 'Radian'); expect(results()).toContain('1.57 rad');
  await act(async () => document.querySelector('[aria-label="Remove Vertex 2"]').click());
  expect(document.querySelector('[aria-label="Measurements"]')).toBeNull();
  expect(document.body.textContent).toContain('(2/3)');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(measureWindowOpen()).toBe(false);
  expect(cadSelection.snapshot().filter).toBe('auto');
  expect(document.querySelector('.cad-measure-overlay')).toBeNull();
});

it('object measurements include exact body volume, surface area, dimensions and center', async () => {
  analyzePart.mockResolvedValue({ measurements: [{ body_id: 'p', volume_mm3: 16387.064, area_mm2: 645.16, center_mm: [12.7, 0, 0], bounds_mm: [25.4, 50.8, 25.4] }] });
  await select([{ id: 'body:p', partId: 'p', kind: 'body', label: 'Plate' }]);
  expect(analyzePart).toHaveBeenCalledWith(part, { kind: 'properties', bodyIds: ['p'] }, expect.anything());
  expect(results()).toContain('1.000 in³'); expect(results()).toContain('1.000 in²');
  expect(results()).toContain('Center X'); expect(results()).toContain('0.500 in');
});

it('a completed older request cannot replace a newer result with the same selected references', async () => {
  const pending = [];
  analyzePart.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const pair = [{ id: 'face:a:7', kind: 'face', partId: 'a', label: 'Face A', faceId: 7 }, { id: 'face:b:8', kind: 'face', partId: 'b', label: 'Face B', faceId: 8 }];
  await select(pair); await select([]); await select(pair);
  await act(async () => pending[1]({ measurements: [{ distance_mm: 25.4, points: [[0,0,0],[25.4,0,0]] }] }));
  await act(async () => pending[0]({ measurements: [{ distance_mm: 50.8, points: [[0,0,0],[50.8,0,0]] }] }));
  expect(results()).toContain('1.000 in'); expect(results()).not.toContain('2.000 in');
});


it('measures inferred snap points without sending face or circular edges as minimum-distance references', async () => {
  await choose('Measurement mode', 'Point-to-point');
  expect(picking).toEqual({ active: true, points: true });
  geometry = { points: [
    { selectionId: 'anchor:p:face-1-circle-0', candidateId: 'face-1-circle-0', partId: 'p', positionMillimeters: [0, 0, 0] },
    { selectionId: 'anchor:p:face-2-center', candidateId: 'face-2-center', partId: 'p', positionMillimeters: [0, 0, 25.4] },
  ], measurements: [] };
  await select(geometry.points.map(point => ({ id: point.selectionId, partId: 'p', kind: 'vertex', label: point.candidateId })));
  expect(results()).toContain('1.000 in');
  expect(analyzePart).not.toHaveBeenCalled();
  await choose('Measurement mode', 'Objects');
  expect(picking).toEqual({ active: true, points: false });
});
