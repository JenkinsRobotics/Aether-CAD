/** Apply the resolved visual material while preserving selection colors and hidden-line masks. */
import type { MeshStandardMaterial } from "three";
import { color, dot, float, fract, fwidth, materialColor, mix, normalWorld, reflectVector, select, smoothstep, step, vec3 } from "three/tsl";
import type { CADDisplayStylePolicy, CADSurfaceAnalysisParams } from "./viewport-appearance";
import type { ResolvedAppearance } from "./appearance-themes";

function normalizedDir(d: [number, number, number] | undefined, fallback: [number, number, number]): [number, number, number] {
  const v = d ?? fallback;
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : fallback;
}

/** Configurable surface analysis overlays (SolidCraft's inspect.zebra / draft / curvature_map /
 *  accessibility / environment_map) rendered as Three WebGPU TSL node graphs. */
function installAnalysis(
  material: MeshStandardMaterial,
  analysis: CADDisplayStylePolicy["analysis"],
  params?: CADSurfaceAnalysisParams,
): void {
  const next = analysis ?? "none";
  const key = `${next}:${JSON.stringify(params ?? {})}`;
  if ((material.userData.analysisKey as string | undefined) === key) return;
  material.userData.analysis = next;
  material.userData.analysisKey = key;
  const node = material as unknown as { colorNode: unknown };
  if (next === "none") {
    node.colorNode = null;
  } else if (next === "zebra") {
    const stripes = Math.max(1, Math.min(200, params?.zebraStripes ?? 6));
    node.colorNode = mix(materialColor.mul(0.35), color(0xf2f2f2), step(0.5, fract(reflectVector.y.mul(float(stripes)))));
  } else if (next === "environment-map") {
    // Glossy studio reflection bands (sky, horizon bright band, studio floor) for Class-A inflection checks.
    const ry = reflectVector.y;
    const floorBand = mix(color(0x1f242c), color(0x4b5563), smoothstep(float(-1.0), float(-0.05), ry));
    const horizon = mix(floorBand, color(0xfafcff), smoothstep(float(-0.06), float(0.06), ry).mul(smoothstep(float(0.28), float(0.06), ry)));
    const sky = mix(horizon, color(0x6fa8dc), smoothstep(float(0.15), float(0.85), ry));
    node.colorNode = mix(materialColor.mul(0.25), sky, 0.92);
  } else if (next === "curvature") {
    const bend = fwidth(normalWorld).length();
    const ramp = smoothstep(float(0.0), float(0.25), bend);
    const tint = mix(mix(color(0x3b6fd6), color(0x40cc59), smoothstep(float(0.0), float(0.5), ramp)), color(0xe64040), smoothstep(float(0.5), float(1.0), ramp));
    node.colorNode = mix(materialColor, tint, 0.8);
  } else if (next === "accessibility") {
    const [dx, dy, dz] = normalizedDir(params?.accessibilityDirection, [0, 0, 1]);
    const lean = dot(normalWorld, vec3(dx, dy, dz));
    const t = float(0.05);
    const tint = select(lean.greaterThan(t), color(0x40cc59), select(lean.lessThan(t.negate()), color(0xe64040), color(0xf2d933)));
    node.colorNode = mix(materialColor, tint, 0.75);
  } else {
    const [dx, dy, dz] = normalizedDir(params?.draftDirection, [0, 0, 1]);
    const angleRad = ((params?.draftAngleDegrees ?? 1) * Math.PI) / 180;
    const lean = dot(normalWorld, vec3(dx, dy, dz));
    const t = float(Math.sin(angleRad));
    const tint = select(lean.greaterThan(t), color(0x40cc59), select(lean.lessThan(t.negate()), color(0xe64040), color(0xf2d933)));
    node.colorNode = mix(materialColor, tint, 0.75);
  }
  material.needsUpdate = true;
}

export function applySurfaceAppearance(materials: readonly MeshStandardMaterial[], policy: CADDisplayStylePolicy, resolved: ResolvedAppearance): void {
  for (const material of materials) {
    installAnalysis(material, policy.analysis, policy.analysisParams);
    const opacity = policy.masksSurfaceWithBackground ? policy.surfaceOpacity : policy.surfaceOpacity * resolved.bodyOpacity;
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
