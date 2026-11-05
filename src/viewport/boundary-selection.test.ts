import { expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import type { ImportedModelData, PartGeometryData } from '@aether/core/contracts';
import type { ConnectorCandidate } from '../aether-core';
import { FeaturePreviewLayer } from '../modeling/feature-preview-layer';
import { pickHistoryFace } from './history-face-picking';
import { pickBoundarySelection } from './boundary-selection';

it.each(['orthographic', 'perspective'])('picks a visible boundary rounded outside its triangle in %s without picking through a foreground face', mode => {
  const camera = mode === 'orthographic' ? new OrthographicCamera(0, 20, 20, 0, .1, 100) : new PerspectiveCamera(50, 1, .1, 100);
  if (mode === 'perspective') camera.position.set(10, 10, 30); else camera.position.z = 30;
  camera.updateMatrixWorld();
  const viewport = { left: 0, top: 0, width: 200, height: 200 };
  const project = (p: Vector3) => { const q = p.clone().project(camera); return { x: (q.x + 1) * 100, y: (1 - q.y) * 100 }; };
  const edge: ConnectorCandidate = { faceId: 1, id: 'edge', kind: 'edge-midpoint', label: 'Edge', origin: [10, 0, 10],
    xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], measurements: { linearDirection: [1, 0, 0], lengthMillimeters: 20 } };
  const part = { id: 'p', name: 'Part', sourceDocumentId: 'doc', sourceName: 'Part', vertices: new Float32Array([0, 0, 10, 20, 0, 10, 0, 20, 10]),
    normals: new Float32Array(9), triangles: new Uint32Array([0, 1, 2]), edgeLines: new Float32Array(),
    faceRanges: [{ faceId: 1, start: 0, count: 3 }], topology: [{ id: 1, surfaceType: 'PLANE', candidates: [edge] }] } as PartGeometryData;
  const model: ImportedModelData = { sourceName: 'Earlier', parseMilliseconds: 0, parts: [part] };
  const layer = new FeaturePreviewLayer(); layer.set(model, false);
  const point = project(new Vector3(8, -.12, 10));
  const pointer = { clientX: point.x, clientY: point.y };
  const ray = new Raycaster(); ray.setFromCamera(new Vector2(point.x / 100 - 1, 1 - point.y / 100), camera);
  const pick = (probe: Raycaster) => pickHistoryFace(probe, layer.group, model, { kind: 'edge', point, project });
  expect(pick(ray)).toBeNull();
  expect(pickBoundarySelection(ray, camera, viewport, pointer, 'edge', pick)?.item.id).toBe('edge:p:edge');
  expect(pickBoundarySelection(ray, camera, viewport, pointer, 'face', pick)).toBeNull();
  layer.group.visible = false;
  expect(pickBoundarySelection(ray, camera, viewport, pointer, 'edge', pick)).toBeNull();
  // A nearer face covers both the boundary and every probe; no hidden edge may win.
  const front = { ...part, id: 'front', vertices: new Float32Array([-10, -10, 15, 40, -10, 15, -10, 40, 15]),
    topology: [{ id: 1, surfaceType: 'PLANE', candidates: [] }] };
  model.parts.push(front); layer.set(model, false); layer.group.visible = true;
  expect(pickBoundarySelection(ray, camera, viewport, pointer, 'edge', pick)).toBeNull();
  layer.set(null);
});
