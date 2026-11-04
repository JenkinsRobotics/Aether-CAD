/** Every edge of a pocketed partial revolve is reachable by the one selection rule from both of its
 *  faces, with the pointer on the edge or a few pixels onto the face, from a normal view and zoomed in
 *  (Jonathan, 2026-11-03: the pocket's outer edge could not be picked). Only the raycast is simulated:
 *  the hit face is taken as each adjacent face in turn. */
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { initNodeKernel } from '@aether/core/kernel/node';
import { evaluatePartDocument } from '@aether/core/kernel';
import { createEmptyPartDocument } from '@aether/core/document';
import { projectScreenPoint } from './picking-math';
import { selectionCandidateDistance } from './selection-proximity';
import { resolveSelection, EDGE_REACH_PX } from './selection-rule';

beforeAll(async () => { await initNodeKernel(readFileSync(new URL('../../aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url))); }, 30000);

it('reaches every edge of a pocketed revolve from both faces, at pointer offsets up to the reach', () => {
  const doc = createEmptyPartDocument('Pocketed revolve');
  doc.features.push(
    { id: 'p', type: 'profile', name: 'Profile', plane: 'XZ', offsetMillimeters: 0, suppressed: false, profile: { type: 'polygon', pointsMillimeters: [[20, 0], [60, 0], [60, 40], [50, 40], [50, 15], [35, 15], [35, 40], [20, 40]] } },
    { id: 'rev', type: 'revolve', name: 'Revolve', suppressed: false, profileFeatureId: 'p', axis: 'Z', angleDegrees: 100, operation: 'new', bodyId: 'body' } as never);
  const part = evaluatePartDocument(doc).parts[0];
  const rect = { left: 0, top: 0, width: 1600, height: 1000 } as DOMRect;
  const views = [{ name: 'normal', position: [160, -140, 120] }, { name: 'zoomed', position: [70, -45, 60] }];
  const failures: string[] = [];
  let checks = 0;
  for (const view of views) {
    const camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 1, 2000);
    camera.position.set(...(view.position as [number, number, number])); camera.lookAt(30, 20, 20); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    const project = (p: THREE.Vector3) => projectScreenPoint(p, camera, rect);
    const matrix = new THREE.Matrix4();
    for (const face of part.topology) for (const edge of face.candidates.filter((c) => c.kind === 'edge-midpoint')) {
      const line = edge.polylineMillimeters!;
      const points = Array.from({ length: line.length / 3 }, (_, i) => new THREE.Vector3(line[3 * i], line[3 * i + 1], line[3 * i + 2]));
      for (const fraction of [0.3, 0.5, 0.7]) {
        const at = points[Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))];
        const screen = project(at.clone());
        if (!screen) continue;
        for (const offset of [0, 4, 8]) {
          checks++;
          const pointer = { x: screen.x + offset, y: screen.y };
          const target = resolveSelection('auto', face.candidates, (c) => selectionCandidateDistance(c, matrix, pointer, project));
          // Another edge or a vertex nearer the pointer is the rule working; the face, or nothing, is a miss.
          const ok = target?.kind === 'edge' || target?.kind === 'vertex';
          if (!ok) failures.push(`${view.name}: face ${face.id} ${face.surfaceType} edge ${edge.id} at ${fraction} +${offset}px → ${target?.kind ?? 'nothing'} ${target && 'candidate' in target ? target.candidate.id : ''}`);
        }
      }
    }
  }
  expect(checks).toBeGreaterThan(100);
  expect(failures).toEqual([]);
  expect(EDGE_REACH_PX).toBe(12);
}, 60000);
