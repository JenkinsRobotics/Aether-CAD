import { expect, it } from 'vitest';
import { BufferGeometry, DoubleSide, FrontSide, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector3 } from 'three/webgpu';
import { MeshBVH } from 'three-mesh-bvh';
import { accelerateSurfacePicking } from './surface-picking';

function occurrence(source = new SphereGeometry(10, 48, 32)) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', source.getAttribute('position'));
  geometry.setAttribute('normal', source.getAttribute('normal'));
  geometry.setIndex(source.index);
  geometry.addGroup(0, geometry.index!.count, 0);
  return new Mesh(geometry, [new MeshBasicMaterial({side: DoubleSide}), new MeshBasicMaterial({side: FrontSide})]);
}
function hits(mesh: Mesh, ray: Raycaster) {
  return ray.intersectObject(mesh, false).map(hit => ({
    distance: +hit.distance.toFixed(7), point: hit.point.toArray().map(v => +v.toFixed(7)),
    face: hit.faceIndex, material: hit.face?.materialIndex,
  }));
}
function rays() {
  return Array.from({length: 120}, (_, i) => {
    const origin = new Vector3(Math.sin(i * 1.37) * 25, Math.cos(i * .47) * 20, 30);
    return new Raycaster(origin, new Vector3(i % 5 - 2, i % 3 - 1, 0).sub(origin).normalize(), 1, 200);
  });
}
it('preserves exact hit points, face ordinals, transformed occurrences and both walls of a cut', () => {
  const mesh = occurrence();
  mesh.rotation.set(.2, .4, -.1); mesh.position.set(2, -1, 3); mesh.scale.set(1, 1.5, .7); mesh.updateMatrixWorld(true);
  const index = mesh.geometry.index!.array.slice();
  const expected = rays().map(ray => hits(mesh, ray));
  expect(expected.some(h => h.length >= 2)).toBe(true);
  accelerateSurfacePicking(mesh);
  expect(rays().map(ray => hits(mesh, ray))).toEqual(expected);
  expect(mesh.geometry.index!.array).toEqual(index);
  // Section filtering needs the retained wall even when the first hit is removed.
  expect(rays().map(ray => hits(mesh, ray).filter(h => h.point[2] < 0)))
    .toEqual(expected.map(list => list.filter(h => h.point[2] < 0)));
});
it('shares spatial buffers while retaining per-occurrence selection groups and sidedness', () => {
  const source = new SphereGeometry(10, 48, 32), a = occurrence(source), b = occurrence(source);
  accelerateSurfacePicking(a); accelerateSurfacePicking(b);
  const first = MeshBVH.serialize(a.geometry.boundsTree as MeshBVH, {cloneBuffers:false});
  const second = MeshBVH.serialize(b.geometry.boundsTree as MeshBVH, {cloneBuffers:false});
  expect(second.roots[0]).toBe(first.roots[0]);
  expect(a.geometry.boundsTree).not.toBe(b.geometry.boundsTree);
  b.geometry.clearGroups();
  const half = Math.floor(b.geometry.index!.count / 6) * 3;
  b.geometry.addGroup(0, half, 1); b.geometry.addGroup(half, b.geometry.index!.count-half, 0);
  const control = new Mesh(b.geometry, b.material);
  expect(rays().map(ray => hits(b,ray))).toEqual(rays().map(ray => hits(control,ray)));
  expect(rays().map(ray => hits(a,ray))).not.toEqual(rays().map(ray => hits(b,ray)));
  a.geometry.dispose();
  expect(rays().map(ray => hits(b,ray))).toEqual(rays().map(ray => hits(control,ray)));
});
it.each(['vertices', 'index', 'position-buffer', 'geometry', 'draw-range'] as const)('never queries stale bounds after changing %s', change => {
  const mesh = occurrence(); accelerateSurfacePicking(mesh);
  if (change === 'vertices') mesh.geometry.translate(40, 0, 0);
  if (change === 'index') { mesh.geometry.index!.setX(0, 1); mesh.geometry.index!.needsUpdate = true; }
  if (change === 'position-buffer') mesh.geometry.setAttribute('position', new SphereGeometry(18,48,32).getAttribute('position'));
  if (change === 'geometry') mesh.geometry = new SphereGeometry(5,48,32);
  if (change === 'draw-range') mesh.geometry.setDrawRange(0, 300);
  const control = new Mesh(mesh.geometry, mesh.material);
  expect(rays().map(ray => hits(mesh,ray))).toEqual(rays().map(ray => hits(control,ray)));
});
