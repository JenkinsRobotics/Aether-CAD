/** The Space navigator is the shared navigation cube, rendered at world origin. */
import * as THREE from "three/webgpu";
import { viewportCubeRegionsForUpAxis, viewportCubeColorTokens, type ViewportUpAxis } from "@aether/ui";
import type { StandardCameraView } from "../camera-view";

export interface OrientationCube {
  group: THREE.Group;
  plates: THREE.Mesh[];
  hover: number;
  center: THREE.Vector3;
  outer: THREE.Vector3;
}

function colors() {
  const style = typeof document !== "undefined" && typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
  return Object.fromEntries(Object.entries(viewportCubeColorTokens).map(([key, token]) => [key, new THREE.Color(style?.getPropertyValue(token).trim() || (key === "label" || key === "outline" ? 0x454b53 : key === "hover" ? 0x399cff : 0xc8cdd2))])) as Record<keyof typeof viewportCubeColorTokens, THREE.Color>;
}

/** Fit the whole bounding box inside every facet of the beveled volume,
 * including corners, while retaining the required world-origin center. */
export function orientationCubeHalfSize(bounds: THREE.Box3, upAxis: ViewportUpAxis): number {
  if (bounds.isEmpty()) return 36;
  let half = 0;
  for (const region of viewportCubeRegionsForUpAxis(upAxis)) {
    const normal = new THREE.Vector3(...region.normal);
    const support = normal.x * (normal.x >= 0 ? bounds.max.x : bounds.min.x)
      + normal.y * (normal.y >= 0 ? bounds.max.y : bounds.min.y)
      + normal.z * (normal.z >= 0 ? bounds.max.z : bounds.min.z);
    const facetDistance = normal.dot(new THREE.Vector3(...region.vertices[0]));
    half = Math.max(half, support / facetDistance);
  }
  return Math.max(36, half * 1.12);
}

/** Constant angular footprint independent of model units, size or offset.
 * A sphere enclosing the cube leaves room for orbiting without clipping. */
export function orientationCubeFraming(outer: THREE.Vector3, fieldOfViewDegrees: number, aspect: number) {
  const radius = outer.length();
  const tangent = Math.tan(THREE.MathUtils.degToRad(fieldOfViewDegrees) / 2) * Math.min(1, aspect);
  const distance = radius / Math.sin(Math.atan(tangent * 0.72));
  return { distance, near: Math.max(radius / 10000, 0.001), far: distance + radius * 4 };
}

export function buildOrientationCube(bounds: THREE.Box3, upAxis: ViewportUpAxis = "z"): OrientationCube {
  const half = orientationCubeHalfSize(bounds, upAxis);
  const center = new THREE.Vector3();
  const outer = new THREE.Vector3(half,half,half);
  const group = new THREE.Group(); group.name="World-origin navigation cube";
  const palette = colors();
  const plates = viewportCubeRegionsForUpAxis(upAxis).map(region => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(region.vertices.flatMap(v=>v.map(n=>n*half)),3));
    geometry.setIndex(Array.from({length:region.vertices.length-2},(_,i)=>[0,i+1,i+2]).flat());
    geometry.computeVertexNormals();
    // A faint navigation overlay; the enclosed model stays visible.
    const material = new THREE.MeshBasicMaterial({color:palette[region.kind], side:THREE.FrontSide, transparent:true, opacity:0.08, depthWrite:false});
    const plate = new THREE.Mesh(geometry,material);
    plate.name=region.label;
    plate.userData={view:region.view,direction:region.normal,regionId:region.id,idleColor:palette[region.kind],hoverColor:palette.hover};
    plate.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:palette.outline, transparent:true, opacity:0.25, depthWrite:false})));
    group.add(plate);
    return plate;
  });
  return {group,plates,hover:-1,center,outer};
}

export function disposeOrientationCube(cube: OrientationCube): void {
  cube.group.traverse(node=>{
    if (!(node instanceof THREE.Mesh || node instanceof THREE.LineSegments)) return;
    node.geometry.dispose();
    for(const material of Array.isArray(node.material)?node.material:[node.material]) {
      (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose();
    }
  });
}
export function plateUnderRay(cube: OrientationCube, raycaster: THREE.Raycaster): number {
  const hit=raycaster.intersectObjects(cube.plates,false)[0];
  return hit?cube.plates.indexOf(hit.object as THREE.Mesh):-1;
}
export function paintOrientationHover(cube: OrientationCube, face: number): boolean {
  cube.hover=face;
  cube.plates.forEach((plate,index)=>{
    const material = plate.material as THREE.MeshBasicMaterial;
    material.color.copy(index===face?plate.userData.hoverColor:plate.userData.idleColor);
    material.opacity = index===face ? 0.18 : 0.08;
  });
  return face>=0;
}
export function plateCameraAction(plate: THREE.Mesh | undefined): {view:StandardCameraView}|{direction:THREE.Vector3}|null {
  if(!plate)return null;
  if(plate.userData.view)return {view:plate.userData.view};
  if(plate.userData.direction)return {direction:new THREE.Vector3(...plate.userData.direction as [number,number,number])};
  return null;
}
