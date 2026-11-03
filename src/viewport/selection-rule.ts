/** The one selection rule (Jonathan, 2026-11-03), as Onshape's: under the pointer, a vertex
 *  within reach wins, else an edge within reach, else the face. There are no priorities and
 *  no body/face/edge/vertex filters in the UI; a feature window may restrict the kind while it
 *  picks (faces for a stop face, edges for a fillet), and that restriction only narrows. Hover
 *  and click resolve through this same function, so what is highlighted is what a click selects. */
import type { ConnectorCandidate } from '../aether-core';
import type { CADSelectionFilter } from '../cad-selection-store';

export const VERTEX_REACH_PX = 6;
export const EDGE_REACH_PX = 12;

export type SelectionTarget = { kind: 'face' } | { kind: 'edge' | 'vertex'; candidate: ConnectorCandidate };

export function resolveSelection(filter: CADSelectionFilter, candidates: readonly ConnectorCandidate[], distance: (candidate: ConnectorCandidate) => number): SelectionTarget | null {
  const nearest = (kind: 'edge-midpoint' | 'vertex', reach: number) => {
    let best: ConnectorCandidate | undefined, bestDistance = reach;
    for (const candidate of candidates) {
      if (candidate.kind !== kind) continue;
      const d = distance(candidate);
      if (d <= bestDistance) { best = candidate; bestDistance = d; }
    }
    return best;
  };
  if (filter === 'auto') {
    const vertex = nearest('vertex', VERTEX_REACH_PX); if (vertex) return { kind: 'vertex', candidate: vertex };
    const edge = nearest('edge-midpoint', EDGE_REACH_PX); if (edge) return { kind: 'edge', candidate: edge };
    return { kind: 'face' };
  }
  if (filter === 'face') return { kind: 'face' };
  if (filter === 'edge') { const edge = nearest('edge-midpoint', EDGE_REACH_PX); return edge ? { kind: 'edge', candidate: edge } : null; }
  if (filter === 'vertex') { const vertex = nearest('vertex', EDGE_REACH_PX); return vertex ? { kind: 'vertex', candidate: vertex } : null; }
  return null;
}
