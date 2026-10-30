import { expect, it, vi } from 'vitest';
import { createPreviewCache } from './preview-cache';

it('shares pending and completed images by exact content, including reopen', async () => {
  const render = vi.fn(async (content: string) => content + '.png');
  const preview = createPreviewCache(render);
  const first = preview('part-a'); expect(preview('part-a')).toBe(first);
  expect(await first).toBe('part-a.png');
  expect(await preview('part-a')).toBe('part-a.png'); expect(render).toHaveBeenCalledTimes(1);
  expect(await preview('part-a-edited')).toBe('part-a-edited.png'); expect(render).toHaveBeenCalledTimes(2);
});
it('does not retain failed renders and retries them', async () => {
  const render = vi.fn().mockRejectedValueOnce(Error('Temporary')).mockResolvedValue('image');
  const preview = createPreviewCache(render);
  await expect(preview('part')).rejects.toThrow('Temporary');
  expect(await preview('part')).toBe('image'); expect(render).toHaveBeenCalledTimes(2);
});
it('bounds cached memory and evicts the least recently used image', async () => {
  const render = vi.fn(async (content: string) => content);
  const preview = createPreviewCache(render, 8);
  await preview('a'); await preview('b'); await preview('a'); await preview('c');
  expect(render).toHaveBeenCalledTimes(3);
  await preview('a'); expect(render).toHaveBeenCalledTimes(3);
  await preview('b'); expect(render).toHaveBeenCalledTimes(4);
});
it('caches empty results but does not retain oversized documents', async () => {
  const render = vi.fn(async () => null);
  const preview = createPreviewCache(render, 4);
  await preview('a'); await preview('a'); expect(render).toHaveBeenCalledTimes(1);
  await preview('large'); await preview('large'); expect(render).toHaveBeenCalledTimes(3);
});
