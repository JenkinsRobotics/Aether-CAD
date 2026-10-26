/** Render layer for Section view: clips sectioned parts in real time on the GPU,
 *  fills the cut with a hatched cap and draws the section plane while editing.
 *  Display only — it never reads or changes the CAD document. */
import * as THREE from "three/webgpu";
import { color, float, fract, mix, screenCoordinate, step } from "three/tsl";
import { isSectioned, sectionClipPlane, type SectionView } from "../section/section-view-store";
import { styledLines } from "./styled-lines";

/** A part's edge lines: drawn as screen-space fat lines, which GPU clipping does
 *  not cut correctly, so their segments are cut at the plane instead. */
export interface SectionEdges { show(positions: ArrayLike<number>): void; positions: ArrayLike<number> }

/** Keep the part of each segment (pairs of xyz points) on the kept side of the plane. */
export function clipSegments(positions: ArrayLike<number>, plane: THREE.Plane): number[] {
  const out: number[] = [], a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i + 5 < positions.length; i += 6) {
    a.set(positions[i], positions[i + 1], positions[i + 2]); b.set(positions[i + 3], positions[i + 4], positions[i + 5]);
    const da = plane.distanceToPoint(a), db = plane.distanceToPoint(b);
    if (da < 0 && db < 0) continue;
    if (da < 0) a.lerp(b, da / (da - db)); else if (db < 0) b.lerp(a, db / (db - da));
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  return out;
}

export class SectionLayer {
  /** Parts that are cut live here; the others stay directly in the model root. */
  readonly clipped = new THREE.ClippingGroup();
  private view: SectionView | null = null;
  private clip: THREE.Plane | null = null;
  private readonly cap = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  // Drawn like the reference planes: a faint fill and a crisp border.
  private readonly plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  private readonly outline = styledLines([-.5,-.5,0, .5,-.5,0, .5,-.5,0, .5,.5,0, .5,.5,0, -.5,.5,0, -.5,.5,0, -.5,-.5,0], 0x4f8cff, 1.5, 0.7);

  constructor(private readonly modelRoot: THREE.Group, overlayRoot: THREE.Group) {
    // A closed solid's back faces show only through the cut: drawing them flat
    // and hatched reads as a solid section face, with no extra geometry.
    const stripe = step(float(0.72), fract(screenCoordinate.x.add(screenCoordinate.y).div(9)));
    this.cap.colorNode = mix(color(0xe9b37c), color(0xa8774f), stripe);
    // Shadows come from what is drawn, not from the material cut away.
    this.clipped.clipShadows = true;
    this.modelRoot.add(this.clipped);
    this.plane.renderOrder = this.outline.renderOrder = 2;
    this.outline.raycast = () => {};
    this.plane.add(this.outline);
    this.plane.visible = false;
    overlayRoot.add(this.plane);
  }

  /** Called once per rendered part: adds its cap and places it by the current view. */
  adopt(partId: string, group: THREE.Group, geometry: THREE.BufferGeometry, edges?: SectionEdges): void {
    if (edges) group.userData.sectionEdges = { ...edges, clipped: false };
    const cap = new THREE.Mesh(geometry, this.cap);
    cap.userData.sectionCap = true;
    cap.userData.partId = partId;
    cap.castShadow = false;
    group.add(cap);
    group.userData.partId = partId;
    this.place(group);
  }

  apply(view: SectionView | null, groups: Iterable<THREE.Group>, bounds: THREE.Box3, editing: boolean): void {
    this.view = view;
    const plane = sectionClipPlane(view);
    this.clip = plane ? new THREE.Plane(new THREE.Vector3(...plane.normal), plane.constant) : null;
    this.clipped.clippingPlanes = this.clip ? [this.clip] : [];
    for (const group of groups) this.place(group);
    this.plane.visible = Boolean(this.clip && editing && view?.showPlane !== false && !bounds.isEmpty());
    if (this.clip && this.plane.visible) {
      const normal = this.clip.normal.clone().negate();
      const size = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.8, 1);
      const center = bounds.getCenter(new THREE.Vector3());
      this.plane.position.copy(center).addScaledVector(normal, -(normal.dot(center) - plane!.constant));
      this.plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      this.plane.scale.setScalar(size);
    }
  }

  /** The visible section face of a part, which a click on the cut picks. */
  capOf(group: THREE.Group): THREE.Mesh | undefined {
    return group.children.find(child => child.userData.sectionCap && child.visible) as THREE.Mesh | undefined;
  }

  /** True when a pick at this point lands on material the section has cut away. */
  hides(partId: string, point: THREE.Vector3): boolean {
    return Boolean(this.clip && this.view && isSectioned(this.view, partId) && this.clip.distanceToPoint(point) < -1e-6);
  }

  private place(group: THREE.Group): void {
    const cut = Boolean(this.clip && this.view && isSectioned(this.view, String(group.userData.partId)));
    const parent = cut ? this.clipped : this.modelRoot;
    if (group.parent !== parent) parent.add(group);
    for (const child of group.children) if (child.userData.sectionCap) child.visible = cut;
    const edges = group.userData.sectionEdges as (SectionEdges & { clipped: boolean }) | undefined;
    if (!edges) return;
    if (cut && this.clip) {
      // Segments are in the part's own frame: bring the plane into it.
      group.updateMatrixWorld(true);
      edges.show(clipSegments(edges.positions, this.clip.clone().applyMatrix4(group.matrixWorld.clone().invert())));
      edges.clipped = true;
    } else if (edges.clipped) {
      edges.show(edges.positions);
      edges.clipped = false;
    }
  }
}
