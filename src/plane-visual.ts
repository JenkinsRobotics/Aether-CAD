import * as THREE from "three";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import helvetiker from "three/examples/fonts/helvetiker_regular.typeface.json";

/** Plane labels are vector text, like every other element of the viewport (Jonathan, 2026-11-01). */
const labelFont = new Font(helvetiker as never);
import { styledLines } from "./viewport/styled-lines";
export interface PlaneVisualStyle {
  fillOpacity?: number;
  borderOpacity?: number;
  labelColor?: string;
  borderWidthPx?: number;
  sizeMillimeters?: number;
  labelOpacity?: number;
  labelsVisible?: boolean;
}
export function createPlaneVisual(name:string,color:number,rotation:readonly [number,number,number],style:PlaneVisualStyle={}):THREE.Group {
      // Reference planes read as compact datums, not a backdrop.
      const geometry = new THREE.PlaneGeometry(110, 110);
      const surface = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: style.fillOpacity ?? 0.055,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      surface.userData.planeRole = "fill";
      const outline = styledLines([-55,-55,0,55,-55,0, 55,-55,0,55,55,0, 55,55,0,-55,55,0, -55,55,0,-55,-55,0], color, style.borderWidthPx ?? 1, style.borderOpacity ?? 0.55);
      outline.userData.planeRole = "border";
      outline.raycast = () => {};
      const group = new THREE.Group();
      group.name = name;
      group.rotation.set(...rotation);
      group.add(surface, outline);
      const label=new THREE.Mesh(new THREE.ShapeGeometry(labelFont.generateShapes(name.replace(" Plane",""),6)),
        new THREE.MeshBasicMaterial({color:new THREE.Color(style.labelColor ?? "#a9cfff"),opacity:style.labelOpacity ?? 1,transparent:true,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
      label.userData.planeRole="label";label.position.set(-52,46,0.05);label.raycast=()=>{};label.visible=style.labelsVisible ?? true;group.add(label);
      updatePlaneVisual(group,color,style);
return group;
}

/** Update the existing datum so visibility, support references and current
 * highlight survive live palette changes. */
export function updatePlaneVisual(group: THREE.Group, color: number, style: PlaneVisualStyle): void {
  group.scale.setScalar((style.sizeMillimeters ?? 110) / 110);
  for (const child of group.children) {
    const role = child.userData.planeRole;
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial & { linewidth?: number };
    if (!role || !material) continue;
    const baseColor = role === 'label' ? new THREE.Color(style.labelColor ?? '#a9cfff').getHex() : color;
    const baseOpacity = role === 'label' ? style.labelOpacity ?? 1 : role === 'border' ? style.borderOpacity ?? .55 : style.fillOpacity ?? .055;
    child.userData.baseColor = baseColor; child.userData.baseOpacity = baseOpacity;
    material.color.setHex(child.userData.planeTint ?? baseColor);
    material.opacity = child.userData.planeTint == null ? baseOpacity : Math.min(1, baseOpacity * 2.2);
    if (role === 'border') material.linewidth = style.borderWidthPx ?? 1;
    if (role === 'label') {
      child.visible = style.labelsVisible ?? true;
      if (child.userData.planeTint == null) material.color.set(style.labelColor ?? '#a9cfff');
    }
  }
  group.updateMatrixWorld(true);
}

/** Tint a plane's meshes and lines, or restore them when the colour is null.
 *
 *  The original colour and opacity are remembered on first tint, so repeated
 *  tinting cannot ratchet a plane permanently brighter — restoring goes back
 *  to what the plane was built with, not to whatever it was tinted to last.
 */
export function tintPlane(group: THREE.Object3D, color: number | null): void {
  for (const child of group.children) {
    const material = (child as THREE.Mesh | THREE.LineSegments).material as
      | THREE.MeshBasicMaterial
      | THREE.LineBasicMaterial
      | undefined;
    if (!material?.color) continue;
    if (child.userData.baseColor === undefined)
      child.userData.baseColor = material.color.getHex();
    child.userData.planeTint = color;
    material.color.setHex(color ?? (child.userData.baseColor as number));
    // The authoring plane reads stronger than a resting datum.
    if ("opacity" in material) {
      if (child.userData.baseOpacity === undefined)
        child.userData.baseOpacity = material.opacity;
      material.opacity = color === null
        ? (child.userData.baseOpacity as number)
        : Math.min(1, (child.userData.baseOpacity as number) * 2.2);
    }
  }
}
