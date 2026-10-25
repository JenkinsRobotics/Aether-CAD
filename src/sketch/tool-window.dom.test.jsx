import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, createSketchToolWindow;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event']) vi.stubGlobal(key, dom.window[key]);
  ({ createSketchToolWindow } = await import('./tool-window'));
});
afterAll(async () => {
  await new Promise(setImmediate);
  dom.window.close();
  vi.unstubAllGlobals();
});
it('replaces sketch settings while a tool is open and restores them on Done', () => {
  const root = document.createElement('section');
  const settings = document.createElement('div');
  settings.className = 'cad-sketch-window';
  root.append(settings); document.body.append(root);
  const select = vi.fn();
  const editor = createSketchToolWindow(root, () => true, select);
  const fields = editor.section('coordinates', 'Circle');
  const input = document.createElement('input');
  input.value = '12'; fields.append(input);
  try {
    editor.show('coordinates');
    expect(settings.hidden).toBe(true);
    expect(root.querySelector('[aria-label="Sketch editor"]')).toBeNull();
    editor.setTitle('coordinates', 'Rectangle');
    expect(root.querySelector('.aui-float-panel-title').textContent).toBe('Rectangle');
    expect(input.value).toBe('12');
    root.querySelector('[data-feature-action="accept"]').click();
    expect(select).toHaveBeenCalledOnce();
    expect(settings.hidden).toBe(false);
    expect(root.querySelector('.cad-sketch-tool-window')).toBeNull();
  } finally {
    editor.dispose(); root.remove();
  }
});
