import { expect, it, vi } from 'vitest';
import { Matrix4, Mesh } from 'three/webgpu';
import type { PartFeature } from '@aether/core/document';
import type { PartGeometryData } from '@aether/core/contracts';
import { resolveFeatureInputs } from '../modeling/feature-input-feedback';
import { FeatureInputLayer, featureInputColors } from './feature-input-layer';

const edge = { id: 'edge', faceId: 7, kind: 'edge-midpoint' as const, label: 'Edge', origin: [1,0,0] as [number,number,number], xAxis: [1,0,0] as [number,number,number], yAxis: [0,1,0] as [number,number,number], zAxis: [0,0,1] as [number,number,number], polylineMillimeters: [0,0,0,2,0,0], measurements: { lengthMillimeters: 2 } };
const part: PartGeometryData = { id: 'body', name: 'Body', sourceDocumentId: 'doc', sourceName: 'Part', vertices: new Float32Array([0,0,0,2,0,0,0,2,0]), normals: new Float32Array(9), triangles: new Uint32Array([0,1,2]), edgeLines: new Float32Array(), faceRanges: [{ faceId: 7, start: 0, count: 3 }], topology: [{ id: 7, surfaceType: 'PLANE', candidates: [edge], measurements: { planarNormal: [0,0,1], centerMillimeters: [2/3,2/3,0], areaSquareMillimeters: 2 } }] };
const ref = { kind: 'face-edges', bodyId: 'body', sourceFeatureId: 'base', normal: [0,0,1], label: 'Face 1' };
const feature = { type: 'fillet', id: 'finish', name: 'Fillet', suppressed: false, radiusMillimeters: .508, targetBodyId: 'body', edges: [ref] } as PartFeature;
it('retains a selected face and every boundary when the preview fails, then disposes on cancel', () => {
  const layer = new FeatureInputLayer(), place = () => new Matrix4().makeTranslation(10,20,30);
  layer.set({ feature, status: 'pending' }, [part], place);
  const holder = layer.group.children[0], line = holder.children[0] as Mesh, face = holder.children[1] as Mesh;
  expect(holder.matrix.elements.slice(12,15)).toEqual([10,20,30]);
  expect((line.material as any).color.getHex()).toBe(featureInputColors.selected);
  expect(face.geometry.index?.array).toEqual(new Uint16Array([0,1,2]));
  const dispose = vi.spyOn(line.geometry, 'dispose');
  layer.set({ feature, status: 'error', message: 'Invalid corner' }, [part], place);
  expect(dispose).toHaveBeenCalledOnce();
  expect(layer.group.children[0].children).toHaveLength(2);
  for (const object of layer.group.children[0].children) expect(((object as Mesh).material as any).color.getHex()).toBe(featureInputColors.error);
  layer.set(null, [part], place); expect(layer.group.children).toHaveLength(0);
});
it('resolves multiple selected edges independently and refuses missing or ambiguous faces', () => {
  const selected = { ...feature, edges: [ref, { bodyId: 'body', midpointMillimeters: [1,0,0], lengthMillimeters: 2 }] } as PartFeature;
  expect(resolveFeatureInputs(selected, [part])).toHaveLength(2);
  expect(resolveFeatureInputs(feature, [{ ...part, topology: [...part.topology, { ...part.topology[0], id: 8 }] }])).toHaveLength(0);
  expect(resolveFeatureInputs(feature, [{ ...part, id: 'other' }])).toHaveLength(0);
  expect(resolveFeatureInputs({ ...feature, edges: [{ ...ref, normal: [0,1,0] }] } as PartFeature, [part])).toHaveLength(0);
});

for (const type of ['chamfer', 'shell', 'draft', 'offset-face']) it(`shares persistent face feedback with ${type}`, () => {
  const selected = { ...feature, type, edges: undefined, faces: [ref] } as unknown as PartFeature;
  const layer = new FeatureInputLayer();
  layer.set({ feature: selected, status: 'error' }, [part], () => new Matrix4());
  expect(layer.group.children[0].children).toHaveLength(2);
  expect(((layer.group.children[0].children[0] as Mesh).material as any).color.getHex()).toBe(featureInputColors.error);
  layer.set(null, [], () => new Matrix4());
});
