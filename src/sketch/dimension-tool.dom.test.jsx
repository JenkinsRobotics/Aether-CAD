import { clickSketchControl, querySketchControl, querySketchControls } from "./test-controls";
import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, serializePartDocument, parsePartDocument } from '@aether/core/document';
import { cadCommands } from '../cad-command-registry';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let dom, open, doc, apply, unregister, svg;
beforeAll(async () => {
  dom = new JSDOM('<body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(() => {
  document.body.innerHTML = '<button id="ribbon">Dimension</button><div class="cad-studio-viewport"></div>';
  doc = createEmptyPartDocument('Dimensions');
  doc.features.push({ id: 's', name: 'Sketch 1', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [
      { type: 'path', start: [0, 0], segments: [{ type: 'line', end: [20, 0] }] },
      { type: 'circle', center: [40, 20], radius: 5 },
    ], constraints: [] } });
  apply = vi.fn(async next => { doc = next; });
  unregister = cadCommands.register('sketch-constraint-distance', () => window.dispatchEvent(new CustomEvent('aether-sketch-constraint', { detail: 'distance' })));
  cadCommands.setEnabled('sketch-constraint-distance', true);
});
afterEach(() => { button('Cancel')?.click(); unregister(); });
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const button = text => ['Undo', 'Redo'].includes(text) ? { click: () => clickSketchControl(text) } : [...querySketchControls('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === (text === 'Cancel' ? 'Cancel sketch' : text));
const panel = () => querySketchControl('.cad-sketch-dimension-entry');
const key = (target = document.body, options = {}) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true, ...options }));
function start(inWorld = false) {
  const connect = e => { document.body.append(e.detail.svg); e.detail.connect({ toSketch: (x, y) => [x, -y], scaleAt: () => .1, updateBounds() {} }); };
  if (inWorld) window.addEventListener('aether-sketch-surface', connect, { once: true });
  open(() => doc, apply, doc.features[0]);
  svg = querySketchControl('[aria-label="2D sketch canvas"]');
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
  svg.getScreenCTM = () => ({ a: 1, b: 0, inverse: () => ({}) });
}
const pick = (x, y) => svg.dispatchEvent(new dom.window.MouseEvent('click', { clientX: x, clientY: -y, bubbles: true }));
function submit(value) {
  const input = panel().querySelector('input'); expect(input).not.toBeNull(); input.value = value;
  panel().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}
it('D from toolbar focus dimensions a line visibly, supports undo/redo and persists through save/reopen', async () => {
  start(); key(querySketchControl('#ribbon'));
  expect(svg.dataset.dimensionTool).toBe('active'); expect(panel()).toBeNull();
  pick(10, 0); pick(10, -10); expect(panel().querySelector('input').value).toBe('20');
  submit('30'); expect(panel()).toBeNull(); expect(apply).not.toHaveBeenCalled();
  button('Undo').click(); button('Redo').click();
  button('Finish sketch').click(); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  doc = parsePartDocument(serializePartDocument(doc));
  expect(doc.features[0].profile.constraints).toMatchObject([{ kind: 'length', value: 30 }]);
  const c = doc.features[0].profile.contours[0]; expect(Math.hypot(c.segments[0].end[0] - c.start[0], c.segments[0].end[1] - c.start[1])).toBeCloseTo(30);
  start(); expect(querySketchControl('.sketch-dimension')).not.toBeNull();
});
it('D on the reparented 3D surface creates a circle diameter and edits it without a duplicate constraint', async () => {
  start(true); key(svg); pick(45, 20); pick(50, 30); expect(panel().querySelector('input').value).toBe('10'); submit('16');
  key(svg); pick(48, 20); pick(52, 30); submit('12');
  button('Finish sketch').click(); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.contours[1].radius).toBeCloseTo(6);
  expect(doc.features[0].profile.constraints).toMatchObject([{ kind: 'diameter', value: 12 }]);
  expect(doc.features[0].profile.constraints).toHaveLength(1);
});
it('picks two points and creates a driving distance', async () => {
  start(); key(); pick(0, 0); expect(panel()).toBeNull(); pick(20, 0); pick(30, -10); submit('25');
  button('Finish sketch').click(); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.constraints).toMatchObject([{ kind: 'distance', value: 25, a: { kind: 'point' }, b: { kind: 'point' } }]);
});
it('keeps typing/modifier/repeat/composition events out of the tool and stops listening after sketch close', () => {
  start();
  for (const tag of ['input', 'textarea', 'select']) { const field = document.createElement(tag); document.body.append(field); key(field); expect(svg.dataset.dimensionTool).toBeUndefined(); }
  const editable = document.createElement('div'); editable.setAttribute('contenteditable', 'true'); editable.innerHTML = '<span>Text</span>'; document.body.append(editable); key(editable.firstChild); expect(svg.dataset.dimensionTool).toBeUndefined();
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) { key(document.body, options); expect(svg.dataset.dimensionTool).toBeUndefined(); }
  button('Cancel').click(); key(); expect(panel()).toBeNull();
});
it('the ribbon command uses the same editor; Escape or invalid input never saves geometry', () => {
  start(); cadCommands.execute('sketch-constraint-distance'); pick(45, 20); pick(50, 30); submit('-1');
  expect(panel().textContent).toContain('positive dimension'); expect(apply).not.toHaveBeenCalled();
  key(panel().querySelector('input'), { key: 'Escape' }); expect(panel()).toBeNull(); expect(svg.dataset.dimensionTool).toBe('active'); key(svg, { key: 'Escape' });
  expect(doc.features[0].profile.contours[1].radius).toBe(5); expect(cadCommands.snapshot()['sketch-constraint-distance'].active).toBe(false);
});

it('infers an angle from two lines and keeps the tool active for the next dimension', async () => {
  doc.features[0].profile.contours.push({ type: 'path', start: [0,0], segments: [{ type: 'line', end: [10,10] }] });
  start(); key(); pick(10,0); pick(5,5); pick(12,5);
  expect(panel().querySelector('.dimension-entry-unit').textContent).toBe('deg'); submit('60');
  expect(svg.dataset.dimensionTool).toBe('active'); expect(panel()).toBeNull();
  pick(45,20); pick(50,30); submit('14');
  button('Finish sketch').click(); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.constraints.map(c=>c.kind)).toEqual(['angle','diameter']);
});
it('previews horizontal and vertical measurements by label position without committing until confirmation', async () => {
  doc.features[0].profile.contours[0].segments[0].end = [20,15];
  start(); key(); pick(0,0); pick(20,15);
  svg.dispatchEvent(new dom.window.MouseEvent('pointermove', {clientX:30,clientY:-8,bubbles:true}));
  expect(svg.querySelector('.sketch-dimension-preview [data-dimension-axis]').getAttribute('data-dimension-axis')).toBe('y');
  svg.dispatchEvent(new dom.window.MouseEvent('pointermove', {clientX:10,clientY:-25,bubbles:true}));
  expect(svg.querySelector('.sketch-dimension-preview [data-dimension-axis]').getAttribute('data-dimension-axis')).toBe('x');
  expect(doc.features[0].profile.constraints).toEqual([]);
  pick(10,25); submit('30'); button('Finish sketch').click(); await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.constraints).toMatchObject([{kind:'horizontal-distance',value:30}]);
});
it('box-selects multiple sketch edges and passes their selection to the unified dimension command', async () => {
  doc.features[0].profile.contours[1] = { type:'path', start:[0,5], segments:[{type:'line',end:[20,5]}] };
  start();
  const pointer=(type,x,y)=>{const e=new dom.window.MouseEvent(type,{clientX:x,clientY:-y,button:0,bubbles:true});Object.defineProperty(e,'pointerId',{value:1});svg.dispatchEvent(e);};
  pointer('pointerdown',-5,10);pointer('pointermove',25,-5);pointer('pointerup',25,-5);pick(25,-5);
  expect(svg.querySelectorAll('.sketch-selection')).toHaveLength(2);
  key();pick(30,2);expect(panel().querySelector('input').value).toBe('5');submit('8');
  button('Finish sketch').click();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.constraints).toMatchObject([{kind:'distance',value:8}]);
});
it('infers a radius from an arc without selecting a dimension type', async () => {
  doc.features[0].profile.contours = [{ type:'path', start:[-5,0], segments:[{type:'arc',middle:[0,5],end:[5,0]}] }];
  start(); key(); pick(0,5); pick(10,10);
  expect(panel().querySelector('input').value).toBe('5'); submit('8');
  button('Finish sketch').click(); await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.constraints).toMatchObject([{kind:'radius',value:8,a:{kind:'arc'}}]);
});
