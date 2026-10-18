/** Retain the renderer's shadow node across preset changes. Toggling castShadow
 * disposes its render target; cached node materials can still reference it.
 * Intensity changes visibility without replacing that GPU resource. */
export function applyContactShadows(light: {
  castShadow: boolean;
  shadow: { intensity: number; autoUpdate: boolean; needsUpdate: boolean };
}, floor: { receiveShadow: boolean }, enabled: boolean): void {
  light.castShadow = true;
  light.shadow.intensity = enabled ? 1 : 0;
  light.shadow.autoUpdate = enabled;
  light.shadow.needsUpdate = enabled;
  floor.receiveShadow = true;
}
