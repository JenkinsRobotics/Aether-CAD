import { expect, test } from 'vitest';
import * as THREE from 'three';
import { createPreviewScene } from './preview-scene';
import type { PartGeometryData } from './aether-core';

test('empty geometry has no invented object preview', () => {
  expect(createPreviewScene([])).toBeNull();
});
test('fits large translated geometry in the thumbnail and preserves model coordinates', () => {
  const box = new THREE.BoxGeometry(100, 30, 20); box.translate(4000, -2500, 600);
  const vertices = box.attributes.position.array as Float32Array;
  const part = {vertices, normals:box.attributes.normal.array, triangles:box.index!.array, edgeLines:new Float32Array()} as PartGeometryData;
  const result = createPreviewScene([part])!;
  result.camera.updateProjectionMatrix();
  for(let i=0;i<vertices.length;i+=3) {
    const projected = new THREE.Vector3(vertices[i],vertices[i+1],vertices[i+2]).project(result.camera);
    expect(Math.abs(projected.x)).toBeLessThan(1);
    expect(Math.abs(projected.y)).toBeLessThan(1);
    expect(Math.abs(projected.z)).toBeLessThan(1);
  }
  expect(vertices[0]).toBeGreaterThan(3900);
  result.dispose(); box.dispose();
});
test('fits each assembly occurrence at its solved pose without mutating shared vertices', () => {
  const box = new THREE.BoxGeometry(10, 20, 30);
  const data = { id: 'occurrence', vertices: box.attributes.position.array, normals: box.attributes.normal.array, triangles: box.index!.array, edgeLines: new Float32Array() } as PartGeometryData;
  const result = createPreviewScene([data], new Map([[data.id, { positionMillimeters: [1000, 0, 0], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }]]))!;
  const bounds = new THREE.Box3().setFromObject(result.scene.children[0]);
  expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(1000);
  expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(20);
  expect(Math.abs(data.vertices[0])).toBe(5);
  result.dispose(); box.dispose();
});
