import { useEffect, useState } from 'react';
import { tabPartCode, type CADTabTarget } from '../document-tab-actions';
import type { Project } from '../host-library';
import { loadPartThumbnails } from './part-thumbnails';

export function usePartThumbnails(targets: CADTabTarget[], project: Project | null, refresh: string) {
  const [images, setImages] = useState<Record<string, string>>({});
  // Scope includes container, branch and revision: equal element IDs in another
  // document must never retain the previous document's picture.
  const scope = JSON.stringify(targets);
  useEffect(() => {
    const controller = new AbortController();
    setImages({});
    if (targets.length) void import('../preview-document').then(({ previewDocument }) =>
      loadPartThumbnails(targets, project, {
        read: tabPartCode, render: previewDocument, signal: controller.signal,
        publish: (id, image) => setImages(previous => ({ ...previous, [id]: image })),
      }));
    return () => controller.abort();
  }, [scope, project, refresh]);
  return images;
}
