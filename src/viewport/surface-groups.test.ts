import { describe, expect, it } from 'vitest';
import { BufferGeometry, Uint32BufferAttribute } from 'three/webgpu';
import { paintSurfaceFace, setSurfaceGroups } from './surface-groups';
import { faceIdForTriangle } from './picking-math';

describe('batched surface appearance', () => {
  const faces = Array.from({length:6}, (_, i) => ({faceId:i+1,start:i*6,count:6}));
  it('draws six ordinary faces once without changing face picking', () => {
    const geometry = new BufferGeometry();
    setSurfaceGroups(geometry, faces, () => 0);
    expect(geometry.groups).toEqual([{start:0,count:36,materialIndex:0}]);
    expect(faceIdForTriangle(faces, 8)).toBe(5);
  });
  it('splits only highlighted faces and restores a single draw afterwards', () => {
    const geometry = new BufferGeometry();
    setSurfaceGroups(geometry, faces, id => id === 3 ? 2 : 0);
    paintSurfaceFace(geometry, faces, 4, 1);
    expect(geometry.groups).toEqual([
      {start:0,count:12,materialIndex:0}, {start:12,count:6,materialIndex:2},
      {start:18,count:6,materialIndex:1}, {start:24,count:12,materialIndex:0},
    ]);
    setSurfaceGroups(geometry, faces, () => 2);
    expect(geometry.groups).toEqual([{start:0,count:36,materialIndex:2}]);
    setSurfaceGroups(geometry, faces, () => 0);
    const group = geometry.groups[0];
    setSurfaceGroups(geometry, faces, () => 0);
    expect(geometry.groups[0]).toBe(group);
  });
  it('supports meshes without face topology and never joins gaps', () => {
    const geometry = new BufferGeometry();
    geometry.setIndex(new Uint32BufferAttribute([0,1,2],1));
    setSurfaceGroups(geometry, [], () => 1);
    expect(geometry.groups).toEqual([{start:0,count:3,materialIndex:1}]);
    setSurfaceGroups(geometry, [{start:0,count:3,faceId:1},{start:6,count:3,faceId:2}], () => 0);
    expect(geometry.groups).toHaveLength(2);
  });
});
