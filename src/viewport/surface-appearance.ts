/** Apply the resolved visual material while preserving selection colors and hidden-line masks. */
import type { MeshStandardMaterial } from "three";
import type { CADDisplayStylePolicy } from "../viewport-appearance";
import type { ResolvedAppearance } from "./appearance-themes";

export function applySurfaceAppearance(materials: readonly MeshStandardMaterial[], policy: CADDisplayStylePolicy, resolved: ResolvedAppearance): void {
  for (const material of materials) {
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
