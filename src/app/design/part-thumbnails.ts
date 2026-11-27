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
    publish: (id: string, image: string | null) => void;
    signal: AbortSignal;
  },
) {
  const { read, render, publish, signal } = dependencies;
  for (const target of targets) {
    if (signal.aborted) return;
    try {
      const item = target.itemId ? project?.parts.find(part => part.id === target.itemId) : undefined;
      let content: string;
      if (target.kind === 'assembly' && project?.previewProjection && project.previewProjection.assembly_id === target.itemId) {
        const projection = project.previewProjection;
        content = JSON.stringify({ previewProjection: { ...projection, part_definitions: projection.part_definitions.map(part => ({
          ...part, feature_document: project.parts.find(item => item.id === part.id)?.document ?? part.feature_document,
        })) } });
      } else if (target.kind === 'assembly' && project?.previewGraph) {
        content = JSON.stringify({ previewAssemblyId: target.itemId, graph: { ...project.previewGraph,
          part_definitions: project.previewGraph.part_definitions.map(part => ({ ...part,
            feature_document: project.parts.find(item => item.id === part.id)?.document ?? part.feature_document,
          })),
        } });
      } else content = item?.document ? JSON.stringify(item.document) : await read(target);
      if (signal.aborted) return;
      const image = await render(content);
      if (signal.aborted) return;
      publish(target.id, image);
    } catch {
      // Empty/unavailable Parts keep their type icon; do not stop later previews.
    }
  }
}
