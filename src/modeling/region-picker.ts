import * as THREE from "three/webgpu";
import { principalFrame, resolveProfileDrawing, rollbackPosition, type PartDocument } from "@aether/core/document";
import { sketchContourPolyline } from "@aether/core/sketch";
import { sketchRegions } from "../freecad-translate";

/** Filled world-space sketch regions, selectable while a feature asks for one. */
export class RegionPicker {
  readonly group = new THREE.Group();
  private document: PartDocument | null = null;
  private sourceId: string | null = null;
  private active = false;
  private selectedIndices: number[] = [];
  private regionMode = false;
  private curveMode = false;
  private selections: {featureId:string;contourIndex:number}[] | undefined;
  private allowedSourceIds: string[] | undefined;
  private meshes: (THREE.Mesh | THREE.Line)[] = [];
  constructor() {
    window.addEventListener("aether-region-mode", event => {
      const detail = (event as CustomEvent).detail;
      this.active = detail.active;
      this.selections = detail.selections; this.allowedSourceIds = detail.allowedSourceIds;
      this.sourceId = detail.sourceId || null;
      this.selectedIndices = detail.contourIndices ?? (detail.contourIndex == null ? [] : [detail.contourIndex]);
      this.regionMode = detail.regionMode ?? false;
      this.curveMode = detail.curveMode ?? false;
      this.rebuild();
    });
  }
  setDocument(document: PartDocument | null) {
    this.document = document;
    this.rebuild();
  }
  pick(raycaster: THREE.Raycaster): boolean {
    if (!this.active) return false;
    this.group.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(this.meshes, false);
    if (!hits.length) return false;
    // Nested regions: the smallest containing region is the most specific pick.
    const first = hits.sort((a, b) => Math.abs(a.distance - b.distance) < 0.1
      ? a.object.userData.area - b.object.userData.area : a.distance - b.distance)[0];
    for (const mesh of this.meshes) (mesh.material as THREE.MeshBasicMaterial).opacity = mesh === first.object ? 0.45 : 0.1;
    window.dispatchEvent(new CustomEvent("aether-region-picked", { detail: first.object.userData.selection }));
    return true;
  }
  private rebuild() {
    for (const mesh of this.meshes) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
    this.group.clear(); this.meshes = [];
    if (!this.active || !this.document) return;
    for (const feature of this.document.features.slice(0, rollbackPosition(this.document))) {
      if (feature.suppressed || !["profile", "sketch"].includes(feature.type) || (this.sourceId && feature.id !== this.sourceId) || (this.allowedSourceIds && !this.allowedSourceIds.includes(feature.id))) continue;
      if (!("plane" in feature)) continue;
      const frame = "frame" in feature && feature.frame ? feature.frame : principalFrame(feature.plane, "offsetMillimeters" in feature ? feature.offsetMillimeters : 0);
      const origin = new THREE.Vector3(...frame.originMillimeters);
      const x = new THREE.Vector3(...frame.xDirection), normal = new THREE.Vector3(...frame.normal);
      const y = new THREE.Vector3().crossVectors(normal, x);
      const drawing = resolveProfileDrawing(this.document.features, feature.id);
      const regions = sketchRegions(feature,this.curveMode,this.document.features);
      const loops = regions.map(r => sketchContourPolyline(r.previewContour ?? drawing.contours[r.contourIndex]).map(p => new THREE.Vector2(...p)));
      const contains = (outer: THREE.Vector2[], inner: THREE.Vector2[]) => inner.every(p => {
        let inside = false;
        for (let i = 0, j = outer.length-1; i < outer.length; j = i++) {
          const a = outer[i], b = outer[j];
          if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
        }
        return inside;
      });
      for (const [regionIndex, region] of regions.entries()) {
        const contour = region.previewContour ?? drawing.contours[region.contourIndex];
        if (!contour) continue;
        const points = sketchContourPolyline(contour).map(p => new THREE.Vector2(...p));
        if (this.curveMode && points.length >= 2) {
          const chosen=this.selections?.some(p=>p.featureId===feature.id && p.contourIndex===region.contourIndex);
          const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,p.y,0))),new THREE.LineBasicMaterial({color:0xf59f42,transparent:true,opacity:chosen?1:.6,depthTest:false,depthWrite:false}));
          line.matrixAutoUpdate=false;line.matrix.makeBasis(x,y,normal).setPosition(origin);line.renderOrder=20;
          line.userData.selection={featureId:feature.id,contourIndex:region.contourIndex};line.userData.area=0;
          this.meshes.push(line);this.group.add(line);continue;
        }
        if (points.length < 3) continue;
        const shape = new THREE.Shape(points);
        if (this.regionMode) {
          const children = loops.filter((loop, i) => i !== regionIndex && Math.abs(THREE.ShapeUtils.area(loop)) < Math.abs(THREE.ShapeUtils.area(points)) && contains(points, loop));
          for (const child of children) if (!children.some(other => other !== child && contains(other, child))) shape.holes.push(new THREE.Path(child));
        }
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xf59f42, transparent: true, opacity: (this.selections ? this.selections.some(p=>p.featureId===feature.id && p.contourIndex===region.contourIndex) : this.selectedIndices.includes(region.contourIndex)) ? 0.45 : 0.1, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.makeBasis(x, y, normal).setPosition(origin);
        mesh.renderOrder = 20;
        mesh.userData.selection = { featureId: feature.id, contourIndex: region.contourIndex };
        mesh.userData.area = Math.abs(THREE.ShapeUtils.area(points));
        this.meshes.push(mesh); this.group.add(mesh);
      }
    }
  }
}
