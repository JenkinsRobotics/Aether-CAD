import * as THREE from "three/webgpu";
import type { ImportedModelData, PartGeometryData } from "../domain";

export const previewColors = { added: 0x419de6, removed: 0xe34e56, base: 0xb4bbc3 };
/** Temporary exact geometry. Only the earlier-history layer permits face picking;
 * added/removed material previews never enter selection or persistence. */
export class FeaturePreviewLayer {
  readonly group = new THREE.Group();
  active = false;
  /** Keep hidden/isolate-excluded reference bodies out of the preview. Changed
   * material stays visible so the user can inspect the operation being edited. */
  setVisibility(visible:(bodyId:string)=>boolean) {
    for(const object of this.group.children) {
      const id=String(object.userData.previewPartId??'').replace(/^preview:base:/,'');
      object.visible=object.userData.previewRole!=='base'||visible(id);
    }
  }
  set(model: ImportedModelData | null, highlight = true) {
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    this.group.clear(); this.active = model !== null;
    const preview = highlight ? model?.featurePreview : undefined;
    if (preview) {
      // Ghost the retained shape for a cut so an internal pocket remains visible.
      for (const part of preview.base) {
        const removedId = part.id.replace(/^preview:base:/, "preview:removed:");
        this.add([part], "base", preview.removed.some(delta => delta.id === removedId) ? 0.35 : 1);
      }
      // Reference meshes have no exact boolean delta, but stay visible while
      // editing an import or an unrelated solid feature.
      this.add(model?.parts.filter(part => part.geometryKind === "mesh") ?? [], "base", 1);
      this.add(preview.added, "added", 0.55);
      this.add(preview.removed, "removed", 0.55);
    } else this.add(model?.parts ?? [], "base", 1);
  }
  private add(parts: PartGeometryData[], kind: keyof typeof previewColors, opacity: number) {
    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(part.vertices, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.triangles, 1));
      const transparent = opacity < 1;
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: previewColors[kind], roughness: 0.65, metalness: 0.05,
        side: THREE.DoubleSide, transparent, opacity, depthWrite: !transparent,
        polygonOffset: kind !== "base", polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));
      mesh.userData.previewRole = kind; mesh.renderOrder = kind === "base" ? 0 : 2;
      mesh.userData.previewPartId = part.id;
      const lines = new THREE.BufferGeometry(); lines.setAttribute("position", new THREE.BufferAttribute(part.edgeLines, 3));
      const edges = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({
        color: kind === "base" ? 0x454b53 : previewColors[kind],
        transparent, opacity: kind === "base" && transparent ? 0.35 : 0.9, depthWrite: false,
      }));
      edges.userData.previewRole = kind; edges.renderOrder = mesh.renderOrder + 1;
      edges.userData.previewPartId = part.id;
      this.group.add(mesh, edges);
    }
  }
}
