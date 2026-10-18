// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { FeatureGallery, featureEditors } from '../gallery/FeatureGallery';
vi.mock('../gallery/TransformGizmoDemo', () => ({ TransformGizmoDemo: () => <div>Gizmo example</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function mount() {
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<FeatureGallery embedded />));
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); });
test('renders the nine original feature windows, not link placeholders', () => {
  mount();
  expect(featureEditors.map(feature => feature.label)).toEqual(['Sketch', 'Extrude', 'Revolve', 'Sweep', 'Loft', 'Thicken', 'Enclose', 'Plane', 'Mate']);
  expect(container.querySelectorAll('.aui-feature-window')).toHaveLength(9);
  for (const feature of featureEditors) {
    const editor=container.querySelector(`[aria-label="${feature.label} editor"]`)!;
    expect(editor).toBeTruthy();
    expect(editor.querySelector('.aui-feature-footer [aria-label="Fit view"]')).toBeTruthy();
    const help = editor.querySelector<HTMLButtonElement>('.aui-feature-footer [aria-label="Help"]')!;
    expect(help).toBeTruthy();
    expect(help.parentElement?.lastElementChild).toBe(help);
    act(() => help.click());
    expect(help.getAttribute('aria-pressed')).toBe('true');
    expect(editor.querySelector('.aui-feature-help')).toBeNull(); // Help is an accessory state; it does not expand the editor.
    act(() => help.click());
    expect(help.getAttribute('aria-pressed')).toBe('false');
  }
  const sketch=container.querySelector('[aria-label="Sketch editor"]')!;
  expect(sketch.querySelector('.aui-feature-footer [aria-label="View normal to sketch plane"]')).toBeTruthy();
  expect(sketch.querySelector<HTMLInputElement>('[aria-label="Show constraints"]')?.checked).toBe(true);
  expect(sketch.querySelector<HTMLInputElement>('[aria-label="Disable imprinting"]')?.disabled).toBe(true);
  expect(sketch.textContent).not.toContain('Change sketch plane');
  act(()=>sketch.querySelector<HTMLButtonElement>('.aui-feature-entity button')!.click());
  expect(sketch.querySelector<HTMLButtonElement>('.aui-feature-accept')?.disabled).toBe(true);
});
test('search finds an interactive editor and reset restores its input state', () => {
  mount();
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  function filter(value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  filter('extrude');
  expect(container.querySelectorAll('.cad-feature-card')).toHaveLength(1);
  const input = [...container.querySelectorAll('input')].find(input => input.value === '25')!;
  expect(input).toBeTruthy(); input.value = '75';
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Reset Extrude demo"]')!.click());
  expect([...container.querySelectorAll('input')].some(input => input.value === '25')).toBe(true);
  filter('unknown');
  expect(container.querySelector('[role="status"]')?.textContent).toContain('No feature editors');
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Viewport tools')!.click());
  expect(container.textContent).toContain('Gizmo example');
});
