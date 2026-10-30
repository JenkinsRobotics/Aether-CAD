/** Render layer for Section view: clips sectioned parts in real time on the GPU,
 *  fills the cut with a hatched cap and draws the section plane while editing.
 *  Display only — it never reads or changes the CAD document. */
import * as THREE from "three/webgpu";
import { color, float, fract, mix, screenCoordinate, step, uniform } from "three/tsl";
import { isSectioned, sectionClipPlane, sectionClipPlanes, type SectionView } from "../section/section-view-store";
import { styledLines } from "./styled-lines";
import { sectionCapGeometry } from "./section-caps";
import { sectionInspectionGeometry } from '../section/section-topology';
import type { PartGeometryData } from '@aether/core/contracts';
import type { AnchorPart } from './topology-anchors';

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
  private clips: THREE.Plane[] = [];
  private boundaryTolerance = 1e-6;
  private planeCountChanged = false;
  private readonly placements = new WeakMap<THREE.Group, { source: THREE.BufferGeometry; data?: PartGeometryData;
    position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null; key: string }>();
  private readonly indicators = new Map<string, THREE.Mesh>();
  private readonly cap = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 });
  private readonly hoverCap = this.cap.clone();
  private readonly selectedCap = this.cap.clone();
  private readonly hatch = uniform(1);

  constructor(private readonly modelRoot: THREE.Group, private readonly overlayRoot: THREE.Group) {
    const stripe = step(float(0.72), fract(screenCoordinate.x.add(screenCoordinate.y).div(9)));
    this.cap.colorNode = mix(color(0xe9b37c), color(0xa8774f), stripe.mul(this.hatch));
    this.hoverCap.colorNode = mix(color(0x80d2df), color(0x4f9aa9), stripe.mul(this.hatch));
    this.selectedCap.colorNode = mix(color(0x51b9d2), color(0x2c819c), stripe.mul(this.hatch));
    // Shadows come from what is drawn, not from the material cut away.
    this.clipped.clipShadows = true;
    this.modelRoot.add(this.clipped);

  }

  /** Called once per rendered part: adds its cap and places it by the current view. */
  adopt(partId: string, group: THREE.Group, geometry: THREE.BufferGeometry, edges?: SectionEdges, source?: PartGeometryData): void {
    this.placements.delete(group);
    if (edges) group.userData.sectionEdges = { ...edges, clipped: false };
    group.userData.sectionSourceGeometry = geometry;
    group.userData.sectionSourceData = source;
    const cap = new THREE.Mesh(new THREE.BufferGeometry(), [this.cap, this.hoverCap, this.selectedCap]);
    cap.userData.sectionCap = true;
    cap.userData.partId = partId;
    cap.castShadow = false;
    group.add(cap);
    group.userData.partId = partId;
    this.place(group);
  }

  apply(view: SectionView | null, groups: Iterable<THREE.Group>, bounds: THREE.Box3, editing: boolean): void {
    this.view = view;
    this.hatch.value = view?.hatch === false ? 0 : 1;
    const planes = sectionClipPlanes(view);
    this.planeCountChanged = planes.length !== this.clips.length;
    this.clips = planes.map(plane => new THREE.Plane(new THREE.Vector3(...plane.normal),plane.constant));
    // Cap vertices are Float32 and sit exactly on the mathematical cut. GPU
    // plane evaluation must retain that boundary, including oblique cuts. A
    // scale-aware rounding allowance prevents the cap clipping itself into
    // speckles; CPU topology, measurements and the actual cap stay on the cut.
    this.boundaryTolerance = Math.max(bounds.isEmpty() ? 0 : Math.max(
      bounds.min.length(), bounds.max.length(), bounds.getSize(new THREE.Vector3()).length(),
    ) * 1e-6, 1e-6);
    this.clipped.clippingPlanes = this.clips.map(plane => new THREE.Plane(plane.normal.clone(), plane.constant + this.boundaryTolerance));
    for (const group of groups) this.place(group);
    this.planeCountChanged = false;
    for (const [id,indicator] of this.indicators) if (!view?.planes.some(cut => cut.id === id)) {
      indicator.removeFromParent(); indicator.geometry.dispose();
      (indicator.material as THREE.Material).dispose();
      indicator.traverse(child => { if(child !== indicator && child instanceof THREE.Mesh){ child.geometry.dispose(); (child.material as THREE.Material).dispose(); } });
      this.indicators.delete(id);
    }
    for (const cut of view?.planes ?? []) {
      let indicator = this.indicators.get(cut.id);
      if (!indicator) {
        indicator = new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x4f8cff,transparent:true,opacity:.06,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
        const outline = styledLines([-.5,-.5,0,.5,-.5,0,.5,-.5,0,.5,.5,0,.5,.5,0,-.5,.5,0,-.5,.5,0,-.5,-.5,0],0x4f8cff,1.5,.7);
        indicator.renderOrder=outline.renderOrder=2; outline.raycast=()=>{}; indicator.raycast=()=>{};
        indicator.add(outline); this.overlayRoot.add(indicator); this.indicators.set(cut.id,indicator);
      }
      const description=sectionClipPlane(cut);
      indicator.visible=Boolean(description && editing && cut.showPlane !== false && !bounds.isEmpty());
      if(!indicator.visible || !description)continue;
      const plane=new THREE.Plane(new THREE.Vector3(...description.normal),description.constant);
      const size=Math.max(bounds.getSize(new THREE.Vector3()).length()*.8,1);
      plane.projectPoint(bounds.getCenter(new THREE.Vector3()),indicator.position);
      indicator.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),plane.normal);
      indicator.scale.setScalar(size);
      (indicator.material as THREE.MeshBasicMaterial).opacity=cut.id===view?.activePlaneId ? .08 : .025;
    }
  }

  /** Recompute a moved occurrence's local cut without replacing its surface. */
  refreshPlacement(group: THREE.Group): void {
    if (this.clips.length) this.place(group);
  }

  /** The visible section face of a part, which a click on the cut picks. */
  capOf(group: THREE.Group): THREE.Mesh | undefined {
    return group.children.find(child => child.userData.sectionCap && child.visible) as THREE.Mesh | undefined;
  }
  inspectionPart(group:THREE.Group):AnchorPart & {data:PartGeometryData} | null { return group.userData.sectionInspection ?? null; }

  highlight(group: THREE.Group, selected: ReadonlySet<number | undefined>, hovered?: number, whole = false): void {
    const part = this.inspectionPart(group);
    if (!part) return;
    for (const face of part.surface.geometry.groups) {
      const id = part.faceRanges.find(range => range.start === face.start)?.faceId;
      face.materialIndex = whole || selected.has(id) ? 2 : id !== undefined && id === hovered ? 1 : 0;
    }
  }

  /** True when a pick at this point lands on material the section has cut away. */
  hides(partId: string, point: THREE.Vector3): boolean {
    return Boolean(this.view && isSectioned(this.view, partId) && this.clips.some(plane => plane.distanceToPoint(point) < -this.boundaryTolerance));
  }

  private place(group: THREE.Group): void {
    const cut = Boolean(this.clips.length && this.view && isSectioned(this.view, String(group.userData.partId)));
    const parent = cut ? this.clipped : this.modelRoot;
    if (group.parent !== parent || this.planeCountChanged) {
      parent.add(group);
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        // Retire cached draws, including hover/selection materials that may not
        // be visible in this frame. In three r180, needsUpdate alone can bypass
        // the clipping-context cache check and reuse the uncut shader on the
        // next draw. Disposal keeps the material itself and its textures usable;
        // the renderer rebuilds its draws with the new clipping context.
        materials.forEach(material => material.dispose());
      });
    }
    group.updateWorldMatrix(true,false);
    const localPlanes = this.clips.map(plane => plane.clone().applyMatrix4(group.matrixWorld.clone().invert()));
    const source = group.userData.sectionSourceGeometry as THREE.BufferGeometry;
    const data = group.userData.sectionSourceData as PartGeometryData | undefined;
    const ids = this.view?.planes.filter(plane => sectionClipPlane(plane)).map(plane => plane.id) ?? [];
    const position = source.getAttribute('position');
    const positionVersion = position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position?.version;
    const key = JSON.stringify(cut ? [ids, positionVersion, source.index?.version,
      localPlanes.map(plane => [...plane.normal.toArray(), plane.constant])] : false);
    const previous = this.placements.get(group);
    // Accept/Cancel, hatch, plane visibility and active-field changes do not
    // alter the cut. Keep its GPU buffers and exact inspection topology alive.
    if (previous?.source === source && previous.data === data && previous.position === position && previous.index === source.index && previous.key === key) return;
    this.placements.set(group, { source, data, position, index: source.index, key });
    for (const child of group.children) if (child.userData.sectionCap && child instanceof THREE.Mesh) {
      child.visible = cut;
      child.geometry.dispose();
      child.geometry = cut ? sectionCapGeometry(source,localPlanes) : new THREE.BufferGeometry();
      group.userData.sectionInspection = null;
      if(cut && group.userData.sectionSourceData){
        const inspection=sectionInspectionGeometry(child.geometry,group.userData.sectionSourceData,ids);
        group.userData.sectionInspection={data:inspection,group,surface:child,faceRanges:inspection.faceRanges,topology:new Map(inspection.topology.map(face=>[face.id,face]))};
      }
    }
    const edges = group.userData.sectionEdges as (SectionEdges & { clipped: boolean }) | undefined;
    if (!edges) return;
    if (cut && this.clips.length) {
      // Segments are in the part's own frame: bring the plane into it.
      group.updateMatrixWorld(true);
      edges.show(localPlanes.reduce((positions,plane) => clipSegments(positions,plane),Array.from(edges.positions)));
      edges.clipped = true;
    } else if (edges.clipped) {
      edges.show(edges.positions);
      edges.clipped = false;
    }
  }
}
