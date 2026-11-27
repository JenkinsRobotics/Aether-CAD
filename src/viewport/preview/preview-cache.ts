/** Bounded, content-keyed images only: no retained meshes or kernel shapes.
 * Shared pending work survives navigation; failures remain retryable. */
export function createPreviewCache(render: (content: string) => Promise<string | null>, maximumBytes = 8 * 1024 * 1024) {
  const completed = new Map<string, { image: string | null; bytes: number }>();
  const pending = new Map<string, Promise<string | null>>();
  let bytes = 0;
  return (content: string): Promise<string | null> => {
    const cached = completed.get(content);
    if (cached) {
      completed.delete(content); completed.set(content, cached);
      return Promise.resolve(cached.image);
    }
    const running = pending.get(content);
    if (running) return running;
    const result = Promise.resolve().then(() => render(content)).then(image => {
      const size = 2 * (content.length + (image?.length ?? 0));
      if (size <= maximumBytes) {
        while (bytes + size > maximumBytes && completed.size) {
          const oldest = completed.keys().next().value!;
          bytes -= completed.get(oldest)!.bytes; completed.delete(oldest);
        }
        completed.set(content, { image, bytes: size }); bytes += size;
      }
      return image;
    }).finally(() => pending.delete(content));
    pending.set(content, result);
    return result;
  };
}
