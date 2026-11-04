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
const button = label => [...win().querySelectorAll('button')].find(button=>(button.getAttribute('aria-label')??button.textContent)===label);
const pick = items => act(async () => { cadSelection.dispatch({ type: 'replace', items }); await Promise.resolve(); });
const open = () => act(async () => openSectionView());

it('keeps scope instructions in Help and dismisses Help before the section edit', async () => {
  await open();
  expect(win().textContent).not.toContain('All bodies are cut');
  await act(async () => button('Help').click());
  expect(document.querySelector('[role="dialog"]').textContent).toContain('Items to exclude');
  await act(async () => win().querySelectorAll('.aui-feature-tabs button')[1].click());
  expect(document.querySelector('[role="dialog"]').textContent).toContain('Only bodies in Items to include');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(sectionEditorOpen()).toBe(true);
});

it('previews live from a picked planar face and keeps the section on accept', async () => {
  await open();
  expect(win().querySelector('.aui-float-panel-title').textContent).toBe('Section view');
  expect([...win().querySelectorAll('.aui-feature-tabs button')].map(tab => tab.textContent)).toEqual(['Exclude', 'Include']);
  expect(win().querySelector('[aria-label="Section planes"]').dataset.active).toBe('true');
  expect(cadSelection.snapshot().filter).toBe('face');
  await pick([{ id: 'face:p:4', kind: 'face', partId: 'p', label: 'Face 4', partLabel: 'Body 1', faceId: 4 }]);
  // More face picks add planes; bodies require explicit focus on the scope field.
  expect(sectionView.snapshot().planes[0]?.plane).toEqual({ label: 'Face 4', originMillimeters: [0, 0, 10], normal: [0, 0, 1] });
  expect(sectionView.editing()).toBe(true);
  expect(cadSelection.snapshot().items).toEqual([]);
  expect(win().querySelector('[aria-label="Section planes"]').dataset.active).toBe('true');
  expect(cadSelection.snapshot().filter).toBe('face');
  await act(async () => button('Accept section view').click());
  expect(win()).toBeNull();
  expect(sectionView.snapshot().planes[0]?.plane.label).toBe('Face 4');
  expect(sectionView.editing()).toBe(false);
  expect(cadSelection.snapshot().filter).toBe('auto');
});

it('rejects a curved face, and types the offset in document units', async () => {
  await open();
  faceFrame = null;
  await pick([{ id: 'face:p:9', kind: 'face', partId: 'p', label: 'Face 9 of Body 1', faceId: 9 }]);
  expect(document.body.textContent).toContain('Select a planar face');
  expect(sectionView.snapshot().planes[0]?.plane).toBeUndefined();
  faceFrame = { originMillimeters: [0, 0, 10], normal: [0, 0, 1] };
  await pick([{ id: 'face:p:4', kind: 'face', partId: 'p', label: 'Face 4', faceId: 4 }]);
  const offset = win().querySelector('[aria-label="Section offset"]');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(offset, '-6.5'); offset.dispatchEvent(new Event('input', { bubbles: true })); offset.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(sectionView.snapshot().planes[0]?.offsetMillimeters).toBeCloseTo(-6.5);
});

it('lists bodies to exclude or include, toggling repeated picks', async () => {
  sectionView.set({ planes:[{id:"test",plane: { label: 'Top', originMillimeters: [0, 0, 0], normal: [0, 0, 1] }, offsetMillimeters:0}],activePlaneId:"test",mode:"exclude",items:[] });
  await open();
  await pick([{ id: 'face:a:1', kind: 'face', partId: 'a', label: 'Face 1', partLabel: 'Body 1', faceId: 1 }]);
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
  const previous = { planes:[{id:"test",plane: { label: 'Right', originMillimeters: [0, 0, 0], normal: [1, 0, 0] }, offsetMillimeters:3}],activePlaneId:"test",mode:"exclude",items:[] };
  sectionView.set(previous);
  await open();
  await pick([{ id: 'face:p:4', kind: 'face', partId: 'p', label: 'Face 4', faceId: 4 }]);
  expect(sectionView.snapshot().planes[0]?.plane.label).toBe('Right'); // planes field was not active: the pick became an item
  await act(async () => button('Cancel').click());
  expect(sectionView.snapshot()).toBe(previous);
  expect(sectionEditorOpen()).toBe(false);
  await act(async () => turnOffSectionView());
  expect(sectionView.snapshot()).toBeNull();
});


it('the panel offset previews in document units; reversing keeps the cut in place and cancel restores it', async () => {
  const previous = { planes:[{id:"test",plane: { label: 'Top', originMillimeters: [0,0,0], normal: [0,0,1] }, offsetMillimeters:4}],activePlaneId:"test",mode:"exclude",items:[] };
  sectionView.set(previous);
  await open();
  const offset = document.querySelector('[aria-label="Section offset"]');
  await act(async () => { offset.value = '7.5'; offset.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(sectionView.snapshot().planes[0]?.offsetMillimeters).toBe(7.5);
  await act(async () => [...win().querySelectorAll('label')].find(label=>label.textContent.endsWith('Flip cut')).querySelector('input').click());
  expect(sectionView.snapshot().planes[0]?.reversed).toBe(true);
  expect(sectionView.snapshot().planes[0]?.offsetMillimeters).toBe(7.5);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(sectionView.snapshot()).toBe(previous);
  expect(document.querySelector('.cad-section-handle')).toBeNull();
});

it('lists multiple planes, edits each independently and restores the whole set on Cancel',async()=>{
  await open();
  await pick([{id:'face:a:1',kind:'face',partId:'a',label:'Top face',faceId:1}]);
  faceFrame={originMillimeters:[10,0,0],normal:[1,0,0]};
  await pick([{id:'face:a:2',kind:'face',partId:'a',label:'Right face',faceId:2}]);
  expect(sectionView.snapshot().planes).toHaveLength(2);
  const setOffset=async value=>act(async()=>{const input=win().querySelector('[aria-label="Section offset"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));});
  await setOffset('-4');await act(async()=>button('Top face').click());await setOffset('-6');
  expect(sectionView.snapshot().planes.map(plane=>plane.offsetMillimeters)).toEqual([-6,-4]);
  await act(async()=>button('Accept section view').click());const before=sectionView.snapshot();
  await open();await act(async()=>button('Remove Right face').click());expect(sectionView.snapshot().planes).toHaveLength(1);
  await act(async()=>button('Cancel').click());expect(sectionView.snapshot()).toBe(before);expect(before.planes).toHaveLength(2);
});
