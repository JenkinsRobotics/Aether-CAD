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

const card = (label: string) => container.querySelector<HTMLElement>(`section[aria-label="${label} editor"]`);

test('every ribbon feature opens its live window in its own card', async () => {
  mount();
  await act(() => new Promise(resolve => setTimeout(resolve, 50)));
  // The list comes from the ribbon catalog and the commands CAD registers, not a gallery copy.
  for (const label of ['Extrude', 'Revolve', 'Fillet', 'Shell', 'Transform']) {
    expect(card(label), label).toBeTruthy();
    expect(card(label)!.querySelector('.aui-feature-window'), label).toBeTruthy();
  }
  expect(card('Revolve')!.querySelector('.aui-feature-window')!.textContent).toContain('Revolve');
  expect(card('Transform')!.querySelector<HTMLSelectElement>('select[name="Transform type"]')?.value).toBe('translate');
});

test('search narrows the cards and the viewport tab still shows the gizmo', async () => {
  mount();
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const filter = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await filter('fillet');
  expect([...container.querySelectorAll('.cad-feature-card h2')].every(h => /fillet/i.test(h.textContent!))).toBe(true);
  await filter('unknown');
  expect(container.querySelector('[role="status"]')?.textContent).toContain('No feature windows');
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Viewport tools')!.click());
  expect(container.textContent).toContain('Gizmo example');
});

test('the design switch reopens every window in the other Aether UI design', async () => {
  mount();
  await act(() => new Promise(resolve => setTimeout(resolve, 50)));
  expect(card('Extrude')!.querySelector('.aui-feature-window--compact')).toBeTruthy();
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Standard')!.click());
  await act(() => new Promise(resolve => setTimeout(resolve, 50)));
  expect(card('Extrude')!.querySelector('.aui-feature-window--standard')).toBeTruthy();
  expect(card('Extrude')!.querySelectorAll('.aui-feature-window')).toHaveLength(1);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Compact')!.click());
});
