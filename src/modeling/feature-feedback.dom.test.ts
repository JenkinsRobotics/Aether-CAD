// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { configureFeaturePreview, mountFeaturePreview } from './feature-preview';
import { createEmptyPartDocument, type PartFeature } from '@aether/core/document';

const feature = (id: string) => ({ id, name: id, type: 'fillet', suppressed: false, radiusMillimeters: .508, targetBodyId: 'body', edges: [] }) as PartFeature;
afterEach(() => { configureFeaturePreview(null); document.body.replaceChildren(); vi.useRealTimers(); });
it('retains input identity through failed previews, recovers, and clears on cancel', async () => {
  vi.useFakeTimers();
  const input = feature('editing'), later = feature('later');
  const doc = { ...createEmptyPartDocument('Feedback'), features: [input, later], rollbackIndex: 1 };
  const feedback = vi.fn(), show = vi.fn(), errors = vi.fn();
  const evaluate = vi.fn().mockRejectedValueOnce(new Error('Corner cannot be built')).mockResolvedValueOnce({ parts: [] });
  configureFeaturePreview({ evaluate, show, feedback });
  const root = document.createElement('div'); root.innerHTML = '<div class="aui-feature-entities"><span class="aui-feature-entity">Face 1</span></div><div class="aui-feature-entities" aria-label="Optional empty"></div>'; document.body.append(root);
  const preview = mountFeaturePreview(root, () => doc, errors);
  preview.update();
  expect(feedback).toHaveBeenLastCalledWith({ feature: input, status: 'pending', message: undefined });
  await vi.advanceTimersByTimeAsync(110);
  expect(root.dataset.featureValidation).toBe('error');
  expect(root.querySelector('[aria-label="Optional empty"]')?.getAttribute('aria-invalid')).toBe('false');
  expect(root.querySelector('[aria-invalid="true"]')?.textContent).toBe('Face 1');
  expect(feedback).toHaveBeenLastCalledWith({ feature: input, status: 'error', message: 'Corner cannot be built' });
  expect(show).toHaveBeenLastCalledWith(null);
  expect(errors).toHaveBeenLastCalledWith('Corner cannot be built');
  preview.update(); await vi.advanceTimersByTimeAsync(110);
  expect(root.dataset.featureValidation).toBe('valid');
  expect(root.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(feedback).toHaveBeenLastCalledWith({ feature: input, status: 'valid', message: undefined });
  preview.close(); expect(feedback).toHaveBeenLastCalledWith(null);
});
it('never paints stale failed inputs after a new draft or an invalid selection edit', async () => {
  vi.useFakeTimers();
  let input = feature('first'), invalid = false;
  let reject!: (error: Error) => void;
  const feedback = vi.fn();
  configureFeaturePreview({ evaluate: () => new Promise((_, fail) => { reject = fail; }), show: vi.fn(), feedback });
  const root = document.createElement('div'); document.body.append(root);
  const preview = mountFeaturePreview(root, () => {
    if (invalid) throw Error('Select an edge');
    return { ...createEmptyPartDocument('Feedback'), features: [input] };
  }, undefined, undefined, undefined, () => input);
  preview.update(); await vi.advanceTimersByTimeAsync(110);
  input = feature('second'); preview.update();
  reject(Error('Old failure')); await vi.advanceTimersByTimeAsync(1);
  expect(feedback).toHaveBeenLastCalledWith({ feature: input, status: 'pending', message: undefined });
  invalid = true; preview.update();
  expect(feedback).toHaveBeenLastCalledWith({ feature: input, status: 'error', message: 'Select an edge' });
  preview.close();
});
