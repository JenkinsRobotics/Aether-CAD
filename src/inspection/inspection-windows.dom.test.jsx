import { createRequire } from 'node:module';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
vi.mock('../modeling/part-analysis', () => ({ analyzePart: async () => ({ measurements: [] }) }));
let dom, openSectionView, turnOffSectionView, sectionEditorOpen, toggleMeasureWindow, measureWindowOpen, sectionView, cadSelection, openCompactFeatureWindow;
let spacing = 10;
const part = { name: 'Plate', documentId: 'test' };
const section = () => document.querySelector('.cad-section-window');
const measure = () => document.querySelector('.cad-measure-window');
const face = n => ({ id: `face:p:${n}`, kind: 'face', partId: 'p', faceId: n, label: `Face ${n} of Plate` });
const vertices = [1, 2].map(n => ({ id: `vertex:p:v${n}`, kind: 'vertex', partId: 'p', label: `Vertex ${n}` }));
const click = element => act(async () => element.click());
const pick = items => act(async () => cadSelection.dispatch({ type: 'replace', items }));
const openMeasure = () => act(async () => toggleMeasureWindow(() => part));
const choosePoints = async () => {
  await click(measure().querySelector('[aria-label="Measurement mode"]'));
  await click([...document.querySelectorAll('[role="option"]')].find(option => option.textContent === 'Point-to-point'));
};

beforeAll(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/cad/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  ({ openSectionView, turnOffSectionView, sectionEditorOpen } = await import('../section/SectionViewWindow'));
  ({ toggleMeasureWindow, measureWindowOpen } = await import('../measure/MeasureWindow'));
  ({ sectionView } = await import('../section/section-view-store'));
  ({ cadSelection } = await import('../cad-selection-store'));
  ({ openCompactFeatureWindow } = await import('@aether/ui'));
  window.addEventListener('aether-section-face', event => event.detail.respond({ originMillimeters: [0, 0, 0], normal: [0, 0, 1] }));
  window.addEventListener('aether-plane-geometry-request', event => event.detail.respond({ measurements: [], points: event.detail.items.filter(item => item.kind === 'vertex').map((item, index) => ({ selectionId: item.id, partId: 'p', candidateId: item.id.split(':').at(-1), positionMillimeters: [index * spacing, 0, 0] })) }));
});
beforeEach(() => { spacing = 10; document.body.innerHTML = '<div class="cad-studio-viewport"></div>'; sectionView.set(null); cadSelection.dispatch({ type: 'clear' }); cadSelection.dispatch({ type: 'set-filter', filter: 'auto' }); });
afterEach(async () => act(async () => { turnOffSectionView(); if (measureWindowOpen()) toggleMeasureWindow(() => part); }));
afterAll(async () => { await new Promise(setImmediate); dom.window.close(); vi.unstubAllGlobals(); });

it('keeps the cut and measured points independent while focus changes', async () => {
  await act(async () => openSectionView()); await pick([face(1)]);
  const offset = section().querySelector('[aria-label="Section offset"]');
  await act(async () => { offset.value = '4'; offset.dispatchEvent(new Event('input', { bubbles: true })); });
  await openMeasure(); await choosePoints(); await pick(vertices);
  expect(sectionEditorOpen()).toBe(true); expect(sectionView.snapshot().planes).toHaveLength(1);
  expect(sectionView.snapshot().planes[0].offsetMillimeters).toBe(4);
  expect(measure().textContent).toContain('10.000 mm');
  await click(section().querySelector('[aria-label="Section planes"]'));
  expect(cadSelection.snapshot().filter).toBe('face'); await pick([face(2)]);
  expect(sectionView.snapshot().planes).toHaveLength(2);
  expect(measure().textContent).toContain('Vertex 1'); expect(measure().textContent).toContain('10.000 mm');
  await act(async () => { spacing = 20; window.dispatchEvent(new Event('aether-part-updated')); });
  expect(measure().textContent).toContain('20.000 mm');
  await click(measure().querySelector('[aria-label="Select entities to measure"]'));
  expect(cadSelection.snapshot().filter).toBe('vertex'); expect(cadSelection.snapshot().items).toEqual(vertices);
  await click(measure().querySelector('[data-feature-action="discard"]'));
  expect(sectionEditorOpen()).toBe(true); expect(sectionView.snapshot().planes).toHaveLength(2);
  expect(sectionView.snapshot().planes[0].offsetMillimeters).toBe(4);
});

it('supports reverse opening order and Escape closes only the front popup', async () => {
  await openMeasure(); await choosePoints(); await pick(vertices);
  await act(async () => openSectionView()); await pick([face(1)]);
  expect(measureWindowOpen()).toBe(true); expect(measure().textContent).toContain('10.000 mm');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
  expect(sectionEditorOpen()).toBe(false); expect(measureWindowOpen()).toBe(true);
  expect(sectionView.snapshot()).toBeNull(); expect(cadSelection.snapshot().filter).toBe('vertex');
  expect(cadSelection.snapshot().items).toEqual(vertices);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
  expect(measureWindowOpen()).toBe(false); expect(cadSelection.snapshot().filter).toBe('auto');
});

it('closing an inactive section or focusing another editor preserves measurement state', async () => {
  await act(async () => openSectionView()); await pick([face(1)]);
  await openMeasure(); await choosePoints(); await pick(vertices);
  await click(section().querySelector('[data-feature-action="discard"]'));
  expect(measureWindowOpen()).toBe(true); expect(cadSelection.snapshot().filter).toBe('vertex');
  let other;
  await act(async () => { other = openCompactFeatureWindow({ viewport: document.querySelector('.cad-studio-viewport'), className: 'another-tool', title: 'Other tool', onAccept() {}, onDiscard() {} }); });
  await pick([face(9)]);
  expect(measure().textContent).toContain('Vertex 1'); expect(measure().textContent).not.toContain('Face 9');
  await act(async () => other.close());
  expect(cadSelection.snapshot().items).toEqual(vertices); expect(cadSelection.snapshot().filter).toBe('vertex');
});
