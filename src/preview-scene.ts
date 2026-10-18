import * as THREE from 'three';
import type { PartGeometryData } from './aether-core';

/** Read-only thumbnail scene. No editor state or geometry semantics. */
export function createPreviewScene(parts: readonly PartGeometryData[]) {
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  const disposables: {dispose: () => void}[] = [];
  const material = new THREE.MeshStandardMaterial({color: 0x86b4cb, roughness: .38, metalness: .18});
  const edgeMaterial = new THREE.LineBasicMaterial({color: 0x344d60, transparent: true, opacity: .7});
  disposables.push(material, edgeMaterial);
  for (const part of parts) {
    if (!part.vertices.length || !part.triangles.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(part.vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(part.triangles, 1));
    if (part.normals.length === part.vertices.length) geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
    else geometry.computeVertexNormals();
    model.add(new THREE.Mesh(geometry, material)); disposables.push(geometry);
    if (part.edgeLines.length) {
      const edges = new THREE.BufferGeometry();
      edges.setAttribute('position', new THREE.BufferAttribute(part.edgeLines, 3));
      model.add(new THREE.LineSegments(edges, edgeMaterial)); disposables.push(edges);
    }
  }
  scene.add(model);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) { disposables.forEach(item => item.dispose()); return null; }
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, .001);
  const halfHeight = radius * 1.18;
  const camera = new THREE.OrthographicCamera(-halfHeight * 4/3, halfHeight * 4/3, halfHeight, -halfHeight, radius / 100, radius * 20);
  camera.up.set(0, 0, 1);
  camera.position.copy(center).add(new THREE.Vector3(1,-1,.8).normalize().multiplyScalar(radius * 4));
  camera.lookAt(center); camera.updateMatrixWorld();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6c7c8c, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.copy(center).add(new THREE.Vector3(radius, -radius * 2, radius * 3));
  light.target.position.copy(center); scene.add(light, light.target);
  return {scene, camera, dispose: () => disposables.forEach(item => item.dispose())};
}
