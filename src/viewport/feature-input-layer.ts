import * as THREE from 'three/webgpu';
import type { PartGeometryData } from '@aether/core/contracts';
import { resolveFeatureInputs, type FeatureInputState } from '../modeling/feature-input-feedback';
import { styledLines } from './styled-lines';

export const featureInputColors = { selected: 0xffac39, error: 0xed4f58 };
/** Persistent input highlights, independent of result geometry and transient
 * pointer selection. Error color denotes the failed feature's input set. */
export class FeatureInputLayer {
  readonly group = new THREE.Group();
  set(state: FeatureInputState | null, parts: readonly PartGeometryData[], placement: (id: string) => THREE.Matrix4, selectedColor = featureInputColors.selected) {
    this.group.traverse(object => {
      const drawable = object as THREE.Mesh;
      drawable.geometry?.dispose();
      if (drawable.material) (Array.isArray(drawable.material) ? drawable.material : [drawable.material]).forEach(m => m.dispose());
    });
    this.group.clear();
    if (!state) return;
    const color = state.status === 'error' ? featureInputColors.error : selectedColor;
    for (const { part, faceIds, edges } of resolveFeatureInputs(state.feature, parts)) {
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(placement(part.id.replace(/^preview:base:/, '')));
      const positions: number[] = [];
      for (const edge of edges) {
        const line = edge.polylineMillimeters ?? [];
        for (let i = 3; i < line.length; i += 3) positions.push(...line.slice(i - 3, i), ...line.slice(i, i + 3));
      }
      if (positions.length) {
        const outline = styledLines(positions, color, 3);
        outline.material.depthTest = false; outline.renderOrder = 12;
        holder.add(outline);
      }
      const indices = part.faceRanges.filter(f => faceIds.includes(f.faceId)).flatMap(f => Array.from(part.triangles.slice(f.start, f.start + f.count)));
      if (indices.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(part.vertices, 3));
        geometry.setIndex(indices);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: state.status === 'error' ? 0.65 : 0.22, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        mesh.renderOrder = 10; holder.add(mesh);
      }
      this.group.add(holder);
    }
  }
}
