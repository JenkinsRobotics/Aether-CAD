import type { CADTabTarget } from '../document-tab-actions';
import type { Project } from '../host-library';

/** Read the loaded container once, including unopened local/example Parts.
 * Never change the active editor just to obtain a thumbnail. */
export async function loadPartThumbnails(
  targets: readonly CADTabTarget[],
  project: Project | null,
  dependencies: {
    read: (target: CADTabTarget) => Promise<string>;
    render: (content: string) => Promise<string | null>;
    publish: (id: string, image: string) => void;
    signal: AbortSignal;
  },
) {
  const { read, render, publish, signal } = dependencies;
  for (const target of targets) {
    if (signal.aborted) return;
    try {
      const item = target.itemId ? project?.parts.find(part => part.id === target.itemId) : undefined;
      const content = item?.document ? JSON.stringify(item.document) : await read(target);
      if (signal.aborted) return;
      const image = await render(content);
      if (signal.aborted) return;
      if (image) publish(target.id, image);
    } catch {
      // Empty/unavailable Parts keep their type icon; do not stop later previews.
    }
  }
}
