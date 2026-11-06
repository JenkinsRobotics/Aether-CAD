import { useEffect, useState } from 'react';
import { tabPartCode, type CADTabTarget } from '../document-tab-actions';
import type { Project } from '../host-library';
import { readAetherCAD } from '../document/aethercad-archive';
import { loadPartThumbnails } from './part-thumbnails';

export function usePartThumbnails(targets: CADTabTarget[], project: Project | null, refresh: string) {
  const [images, setImages] = useState<Record<string, string>>({});
  // Scope includes container, branch and revision: equal element IDs in another
  // document must never retain the previous document's picture.
  const scope = JSON.stringify(targets);
  useEffect(() => { setImages({}); }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    if (targets.length) void Promise.all([import('../preview-document'), import('../host-library')]).then(([{ previewDocument }, { currentEditorSnapshot }]) => {
      const snapshot = currentEditorSnapshot();
      const live = snapshot ? readAetherCAD(snapshot.bytes).graph.part_definitions.find(part => part.feature_document)?.feature_document : undefined;
      const current = targets.find(target => target.current && target.kind === 'part');
      const updated = live && current && project ? { ...project, parts: project.parts.map(part => part.id === current.itemId ? { ...part, document: live } : part) } : project;
      return loadPartThumbnails(targets, updated, {
        read: target => target.current && snapshot ? Promise.resolve(new TextDecoder().decode(snapshot.bytes)) : tabPartCode(target), render: previewDocument, signal: controller.signal,
        publish: (id, image) => setImages(previous => { const next = { ...previous }; if (image) next[id] = image; else delete next[id]; return next; }),
      });
    }).catch(() => {});
    return () => controller.abort();
  }, [scope, project, refresh]);
  return images;
}
