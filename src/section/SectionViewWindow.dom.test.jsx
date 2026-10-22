import { createRequire } from 'node:module';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let dom, openSectionView, turnOffSectionView, sectionEditorOpen, sectionView, cadSelection, applyDocumentUnits, faceFrame;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/cad/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  ({ openSectionView, turnOffSectionView, sectionEditorOpen } = await import('./SectionViewWindow'));
  ({ sectionView } = await import('./section-view-store'));
  ({ cadSelection } = await import('../cad-selection-store'));
  ({ applyDocumentUnits } = await import('../document-preferences'));
  window.addEventListener('aether-section-face', event => event.detail.respond(faceFrame));
  window.addEventListener('aether-section-handle', event => event.detail.respond(null));
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  faceFrame = { originMillimeters: [0, 0, 10], normal: [0, 0, 1] };
  applyDocumentUnits({ length: { unit: 'mm', decimals: 2 } });
  sectionView.set(null);
});
afterEach(async () => { await act(async () => { turnOffSectionView(); cadSelection.dispatch({ type: 'clear' }); }); });
const win = () => document.querySelector('.cad-section-window');
const button = label => win().querySelector(`[aria-label="${label}"]`);
const pick = items => act(async () => { cadSelection.dispatch({ type: 'replace', items }); await Promise.resolve(); });
const open = () => act(async () => openSectionView());

it('previews live from a picked planar face and keeps the section on accept', async () => {
  await open();
  expect(win().querySelector('.aui-float-panel-title').textContent).toBe('Section view');
  expect([...win().querySelectorAll('.aui-feature-tabs button')].map(tab => tab.textContent)).toEqual(['Exclude', 'Include']);
  expect(win().querySelector('[aria-label="Section planes"]').dataset.active).toBe('true');
  expect(cadSelection.snapshot().filter).toBe('face');
  await pick([{ id: 'face:p:4', kind: 'face', partId: 'p', label: 'Face 4 of Body 1', faceId: 4 }]);
  // The face became the section plane, the model selection was consumed, and picks now go to items.
  expect(sectionView.snapshot().plane).toEqual({ label: 'Face 4 of Body 1', originMillimeters: [0, 0, 10], normal: [0, 0, 1] });
  expect(sectionView.editing()).toBe(true);
  expect(cadSelection.snapshot().items).toEqual([]);
  expect(win().querySelector('[aria-label="Items to exclude"]').dataset.active).toBe('true');
  expect(cadSelection.snapshot().filter).toBe('body');
  await act(async () => button('Accept section view').click());
  expect(win()).toBeNull();
  expect(sectionView.snapshot().plane.label).toBe('Face 4 of Body 1');
  expect(sectionView.editing()).toBe(false);
  expect(cadSelection.snapshot().filter).toBe('auto');
});

it('rejects a curved face, and types the offset in document units', async () => {
  await open();
  faceFrame = null;
  await pick([{ id: 'face:p:9', kind: 'face', partId: 'p', label: 'Face 9 of Body 1', faceId: 9 }]);
  expect(document.body.textContent).toContain('Select a planar face');
  expect(sectionView.snapshot().plane).toBeNull();
  faceFrame = { originMillimeters: [0, 0, 10], normal: [0, 0, 1] };
  await pick([{ id: 'face:p:4', kind: 'face', partId: 'p', label: 'Face 4', faceId: 4 }]);
  const offset = document.querySelector('[aria-label="Section offset (mm)"]');
  await act(async () => { offset.value = '-6.5'; offset.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(sectionView.snapshot().offsetMillimeters).toBeCloseTo(-6.5);
});

it('lists bodies to exclude or include, toggling repeated picks', async () => {
  sectionView.set({ plane: { label: 'Top', originMillimeters: [0, 0, 0], normal: [0, 0, 1] }, offsetMillimeters: 0, mode: 'exclude', items: [] });
  await open();
  await pick([{ id: 'face:a:1', kind: 'face', partId: 'a', label: 'Face 1 of Body 1', faceId: 1 }]);
  // The viewer notifies again for hover in the same tick; the pick must count once.
  await act(async () => { cadSelection.dispatch({ type: 'replace', items: [{ id: 'body:b', kind: 'body', partId: 'b', label: 'Body 2' }] }); cadSelection.dispatch({ type: 'set-hovered', item: null }); await Promise.resolve(); });
  expect(sectionView.snapshot().items).toEqual([{ id: 'a', label: 'Body 1' }, { id: 'b', label: 'Body 2' }]);
  await pick([{ id: 'body:a', kind: 'body', partId: 'a', label: 'Body 1' }]);
  expect(sectionView.snapshot().items).toEqual([{ id: 'b', label: 'Body 2' }]);
  await act(async () => win().querySelectorAll('.aui-feature-tabs button')[1].click());
  expect(sectionView.snapshot().mode).toBe('include');
  expect(win().textContent).toContain('Items to include');
});

it('cancel restores the previous section; turn off clears it', async () => {
  const previous = { plane: { label: 'Right', originMillimeters: [0, 0, 0], normal: [1, 0, 0] }, offsetMillimeters: 3, mode: 'exclude', items: [] };
  sectionView.set(previous);
  await open();
  await pick([{ id: 'face:p:4', kind: 'face', partId: 'p', label: 'Face 4', faceId: 4 }]);
  expect(sectionView.snapshot().plane.label).toBe('Right'); // planes field was not active: the pick became an item
  await act(async () => button('Cancel').click());
  expect(sectionView.snapshot()).toBe(previous);
  expect(sectionEditorOpen()).toBe(false);
  await act(async () => turnOffSectionView());
  expect(sectionView.snapshot()).toBeNull();
});
