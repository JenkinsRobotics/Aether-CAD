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
    // Drawing tools get a strip inside the sketch, not a feature window.
    expect(root.querySelector('[aria-label="Sketch editor"]')).toBeNull();
    expect(root.querySelector('.cad-sketch-tool-window')).toBeNull();
    expect(root.querySelector('.cad-sketch-tool-strip').contains(input)).toBe(true);
    editor.setTitle('coordinates', 'Rectangle');
    expect(input.value).toBe('12');
    editor.close();
    expect(select).not.toHaveBeenCalled();
    expect(settings.hidden).toBe(false);
    expect(root.querySelector('.cad-sketch-tool-strip')).toBeNull();
  } finally {
    editor.dispose(); root.remove();
  }
});

it('keeps live instructions behind Help and restores their ownership across reopen', async () => {
  const root = document.createElement('section'); document.body.append(root);
  const editor = createSketchToolWindow(root, () => true, () => {});
  const fields = editor.section('modify', 'Modify');
  const note = document.createElement('small'); note.dataset.featureHelp = 'true';
  note.textContent = 'Choose an edge'; fields.append(note);
  try {
    editor.show('modify');
    expect(root.textContent).not.toContain('Choose an edge');
    root.querySelector('[aria-label="Help"]').click();
    const help = document.querySelector('[role="dialog"]');
    expect(help.contains(note)).toBe(true);
    note.textContent = 'Choose another edge';
    expect(help.textContent).toContain('Choose another edge');
    editor.close();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fields.contains(note)).toBe(true);
    editor.show('modify');
    root.querySelector('[aria-label="Help"]').click();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Choose another edge');
    fields.replaceChildren();
    await new Promise(setImmediate);
    expect(document.querySelector('[role="dialog"]').textContent).not.toContain('Choose another edge');
  } finally { editor.dispose(); root.remove(); }
});
