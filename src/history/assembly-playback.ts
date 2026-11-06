import { parsePartDocument } from '@aether/core/document';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { AssemblyGeometryCache } from '../assembly/geometry-cache';
import { bodiesForPlacements } from '../startup/assembly-solve';
import type { PlaybackSequence, PlaybackModel, PlaybackService } from './playback';

/** Read-only replay of embedded Part histories, in the same definition order as
 * the assembly history panel. Occurrences retain the assembly's solved pose. */
export function assemblyPlayback(projection: AssemblyProjectionV1, evaluate: PlaybackService['evaluate']): PlaybackSequence {
  const snapshot = structuredClone(projection);
  const used = new Set(snapshot.instances.filter(i => i.definition_kind === 'part').map(i => i.definition_id));
  const sources = snapshot.part_definitions.filter(p => used.has(p.id) && p.feature_document).map(part => ({
    part, document: parsePartDocument(JSON.stringify(part.feature_document)),
  }));
  const cache = new AssemblyGeometryCache({ evaluate, parseDocument: parsePartDocument });
  const features = sources.flatMap(({ part, document }) => document.features.map(f => ({ ...f, name: `${part.name} · ${f.name}` })));
  return {
    features,
    async evaluate(index, isCurrent): Promise<PlaybackModel> {
      const started = performance.now();
      let remaining = index;
      const definitions = sources.flatMap(({ part, document }) => {
        const count = Math.min(remaining, document.features.length);
        remaining -= count;
        return count > 0 ? [{ ...part, feature_document: { ...document, rollbackIndex: count } }] : [];
      });
      const visible = new Set(definitions.map(part => part.id));
      const frame = { ...snapshot, part_definitions: definitions, instances: snapshot.instances.filter(i => visible.has(i.definition_id)) };
      const bodies = await bodiesForPlacements(frame, frame.instances.map(i => ({
        id: i.id, placement_mm: i.solved_world_transform.position_m.map(v => v * 1000) as [number, number, number],
        rotation: [...i.solved_world_transform.rotation_quaternion_xyzw],
      })), { evaluate, parseDocument: parsePartDocument, geometryCache: cache, isCurrent });
      return { sourceName: 'Assembly history', parts: bodies.map(b => b.data), parseMilliseconds: performance.now() - started,
        placements: new Map(bodies.map(b => [b.data.id, { position: b.positionMillimeters, rotation: b.quaternion }])) };
    },
  };
}
