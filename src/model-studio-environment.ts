import { modelStudioEnvironment as look } from '@aether/assets/themes/rendering/model-studio';
import type { CADAppearanceSnapshot } from './cad-appearance-store';
/** The shared artwork uses meters/Y-up. CAD owns its millimeter/up-axis adapter.
 * Camera, document geometry, units and per-object overrides are never reset. */
function direction(vector: readonly number[]) {
  return { azimuth: Number((Math.atan2(-vector[2], vector[0]) * 180 / Math.PI).toFixed(6)),
    elevation: Number((Math.atan2(vector[1], Math.hypot(vector[0], vector[2])) * 180 / Math.PI).toFixed(6)) };
}
const key = direction(look.key.direction), rim = direction(look.rim.direction);
const hex = (value: string) => Number.parseInt(value.slice(1), 16);
export const modelStudioLighting = {
  hemisphere: look.ambient.intensity, key: look.key.intensity, fill: look.fill.intensity, rim: look.rim.intensity,
  sky: hex(look.ambient.sky), ground: hex(look.ambient.ground), keyColor: hex(look.key.color), fillColor: hex(look.fill.color), rimColor: hex(look.rim.color),
};
export const modelStudioEnvironment: Partial<CADAppearanceSnapshot> = {
  environmentTheme: 'model-studio', background: 'graphite', backgroundColor: look.background, backgroundMode: 'solid',
  colorTransform: 'filmic', exposure: look.exposure, lightingPreset: 'model-studio', environmentPercent: 100,
  ambientLightPercent: 100, keyLightPercent: 100, fillLightPercent: 100, rimLightPercent: 100,
  keyLightAzimuthDegrees: key.azimuth, keyLightElevationDegrees: key.elevation,
  rimLightAzimuthDegrees: rim.azimuth, rimLightElevationDegrees: rim.elevation,
  floorMode: 'both', floorColor: look.background, floorOpacityPercent: look.shadow.opacity * 100, floorRoughness: 1, contactShadowsVisible: true,
  gridMinorColor: look.grid.minor, gridMajorColor: look.grid.major,
  gridXAxisColor: look.grid.x, gridYAxisColor: look.grid.y, gridZAxisColor: look.grid.z,
  gridOpacityPercent: 100, gridMinorOpacityPercent: 100, gridMajorOpacityPercent: 100, gridAxisOpacityPercent: 100,
  gridSpacingMillimeters: look.grid.spacingMeters * 1000, gridExtentMillimeters: look.grid.extentMeters * 1000,
  bodyColor: look.surface.color, roughness: look.surface.roughness, metalness: look.surface.metalness,
  displayStyle: 'shaded', edgesVisible: false, bodyOpacityPercent: 100,
  studioReflections: true, reflectionIntensityPercent: look.reflections.intensity * 100, reflectionRotationDegrees: 0,
};
