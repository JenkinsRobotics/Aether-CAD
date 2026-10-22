/** Apply the resolved visual material while preserving selection colors and hidden-line masks. */
import type { MeshStandardMaterial } from "three";
import { color, float, fract, materialColor, mix, normalWorld, reflectVector, select, step } from "three/tsl";
import type { CADDisplayStylePolicy } from "../viewport-appearance";
import type { ResolvedAppearance } from "./appearance-themes";

/** Analysis overlays as node graphs (the viewer renders with three/webgpu, where
 *  node materials replace shader patches; SolidCraft's inspect.zebra / inspect.draft):
 *  zebra stripes follow the reflected view direction, so a kink in the surface kinks
 *  the stripes; draft colouring shows which way each face leans against the pull
 *  direction (+Z): green pulls out, red is undercut, yellow within one degree. */
function installAnalysis(material: MeshStandardMaterial, analysis: CADDisplayStylePolicy["analysis"]): void {
  const current = (material.userData.analysis as string | undefined) ?? "none";
  const next = analysis ?? "none";
  if (current === next) return;
  material.userData.analysis = next;
  const node = material as unknown as { colorNode: unknown };
  if (next === "none") node.colorNode = null;
  else if (next === "zebra") node.colorNode = mix(materialColor.mul(0.35), color(0xf2f2f2), step(0.5, fract(reflectVector.y.mul(6.0))));
  else {
    const lean = normalWorld.z, t = float(Math.sin(Math.PI / 180));
    const tint = select(lean.greaterThan(t), color(0x40cc59), select(lean.lessThan(t.negate()), color(0xe64040), color(0xf2d933)));
    node.colorNode = mix(materialColor, tint, 0.75);
  }
  material.needsUpdate = true;
}

export function applySurfaceAppearance(materials: readonly MeshStandardMaterial[], policy: CADDisplayStylePolicy, resolved: ResolvedAppearance): void {
  for (const material of materials) {
    installAnalysis(material, policy.analysis);
    const opacity = policy.masksSurfaceWithBackground ? policy.surfaceOpacity : policy.surfaceOpacity * resolved.bodyOpacity;
    // Keep exact edge lines slightly ahead of their coplanar face fill.
    // Retain depth testing so rear edges stay occluded.
    material.polygonOffset = policy.edgesVisible && !policy.surfaceWireframe;
    material.polygonOffsetFactor = material.polygonOffset ? 1 : 0;
    material.polygonOffsetUnits = material.polygonOffset ? 1 : 0;
    material.roughness = resolved.finish.roughness;
    material.metalness = resolved.finish.metalness;
    material.wireframe = policy.surfaceWireframe;
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthWrite = policy.surfaceDepthWrite && opacity === 1;
    material.needsUpdate = true;
  }
  const part = materials[0];
  if (!part) return;
  part.color.setHex(policy.masksSurfaceWithBackground ? resolved.background : resolved.bodyColor);
  part.emissive.setHex(policy.masksSurfaceWithBackground ? resolved.background : resolved.emissiveColor);
  part.emissiveIntensity = policy.masksSurfaceWithBackground ? 1 : resolved.emissiveIntensity;
  part.roughness = resolved.finish.roughness;
  part.metalness = resolved.finish.metalness;
}
