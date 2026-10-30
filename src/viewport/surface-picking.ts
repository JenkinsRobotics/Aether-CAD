import { BufferAttribute, Mesh, type Intersection, type Raycaster } from 'three/webgpu';
import { CENTER, MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

type TreeData = ReturnType<typeof MeshBVH.serialize>;
// Occurrences share immutable vertex/index buffers, but have their own draw
// groups and materials. Share the index, never another occurrence's geometry.
const trees = new WeakMap<object, WeakMap<object, TreeData>>();
const ordinaryRaycast = Mesh.prototype.raycast;

/** Accelerate dense CAD surfaces without reordering triangles (face IDs refer
 * to their original ranges). Keep all intersections: a section can hide the
 * nearest triangle while a farther wall of the same body remains selectable. */
export function accelerateSurfacePicking(mesh: Mesh): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  if (!(position instanceof BufferAttribute) || !index || index.count < 768) return;

  let shared = trees.get(position.array);
  if (!shared) trees.set(position.array, shared = new WeakMap());
  const saved = position.version === 0 && index.version === 0 ? shared.get(index.array) : undefined;
  const tree = saved
    ? MeshBVH.deserialize(saved, geometry, { setIndex: false })
    : new MeshBVH(geometry, { indirect: true, strategy: CENTER, targetLeafSize: 8 });
  if (!saved && position.version === 0 && index.version === 0)
    shared.set(index.array, MeshBVH.serialize(tree, { cloneBuffers: false }));
  geometry.boundsTree = tree;
  const positionVersion = position.version, indexVersion = index.version;
  const drawStart = geometry.drawRange.start, drawCount = geometry.drawRange.count;
  mesh.raycast = function (raycaster: Raycaster, hits: Intersection[]) {
    // A caller replacing/editing buffers must never query an old spatial index.
    if (this.geometry !== geometry || geometry.getAttribute('position') !== position ||
        geometry.index !== index || position.version !== positionVersion || index.version !== indexVersion ||
        geometry.drawRange.start !== drawStart || geometry.drawRange.count !== drawCount) {
      geometry.boundsTree = undefined;
      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
      this.raycast = ordinaryRaycast;
      ordinaryRaycast.call(this, raycaster, hits);
      return;
    }
    acceleratedRaycast.call(this, raycaster, hits);
  };
  geometry.addEventListener('dispose', () => { geometry.boundsTree = undefined; });
}
