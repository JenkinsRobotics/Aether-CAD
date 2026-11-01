// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { FeatureGallery } from '../gallery/FeatureGallery';
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
const tool = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.cad-live-list button')].find(button => button.textContent === label);

test('lists the ribbon tools that open a feature window and opens the live one', async () => {
  mount();
  // The list comes from the ribbon catalog and the commands CAD registers, not a gallery copy.
  for (const label of ['Extrude', 'Revolve', 'Fillet', 'Shell']) expect(tool(label)).toBeTruthy();
  await act(async () => tool('Revolve')!.click());
  const windows = [...document.querySelectorAll('.aui-feature-window')];
  expect(windows).toHaveLength(1);
  expect(windows[0].closest('.cad-live-stage')).toBeTruthy();
  expect(windows[0].textContent).toContain('Revolve');
  expect(tool('Revolve')!.getAttribute('aria-pressed')).toBe('true');
});

test('search narrows the list and the viewport tab still shows the gizmo', () => {
  mount();
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const filter = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  filter('fillet');
  expect([...container.querySelectorAll('.cad-live-list button')].every(button => /fillet/i.test(button.textContent!))).toBe(true);
  filter('unknown');
  expect(container.querySelector('[role="status"]')?.textContent).toContain('No feature windows');
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Viewport tools')!.click());
  expect(container.textContent).toContain('Gizmo example');
});

test('Transform opens on translate', async () => {
  mount();
  await act(() => new Promise(resolve => setTimeout(resolve))); // the default Extrude opens first
  for (const [label, mode] of [['Transform', 'translate']] as const) {
    await act(async () => tool(label)!.click());
    const win = document.querySelector('.aui-feature-window')!;
    expect(win).toBeTruthy();
    expect(win.querySelector<HTMLSelectElement>('select[name="Transform type"]')?.value).toBe(mode);
  }
});
