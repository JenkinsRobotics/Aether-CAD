/** Renderer-only controls, in millimeters or CSS pixels as named. */
export const advancedNumberRanges = {
  gridSpacingMillimeters: [0.1, 10000], gridExtentMillimeters: [10, 100000], gridMajorEvery: [2, 20],
  gridMinorOpacityPercent: [0, 100], gridMajorOpacityPercent: [0, 100], gridAxisOpacityPercent: [0, 100],
  gridMinorWidthPx: [0.5, 6], gridMajorWidthPx: [0.5, 8], gridAxisWidthPx: [0.5, 8],
  planeFillOpacityPercent: [0, 100], planeBorderOpacityPercent: [0, 100], planeLabelOpacityPercent: [0, 100],
  planeBorderWidthPx: [0.5, 8], planeSizeMillimeters: [10, 10000],
  edgeWidthPx: [0.5, 8], sketchLineWidthPx: [0.5, 8], sketchGridSpacingMillimeters: [0.1, 1000],
  reflectionIntensityPercent: [0, 200], reflectionRotationDegrees: [-180, 180],
  renderScale: [0.5, 1.5], emissiveIntensity: [0, 5],
  floorOpacityPercent: [0, 100], floorRoughness: [0, 1], exposure: [0.1, 3],
  keyLightAzimuthDegrees: [-180, 180], keyLightElevationDegrees: [-90, 90],
  fillLightAzimuthDegrees: [-180, 180], fillLightElevationDegrees: [-90, 90],
  rimLightAzimuthDegrees: [-180, 180], rimLightElevationDegrees: [-90, 90],
  ambientLightPercent: [0, 300], keyLightPercent: [0, 300], fillLightPercent: [0, 300], rimLightPercent: [0, 300],
} as const;
export const advancedColorKeys = [
  'backgroundBottomColor', 'gridXAxisColor', 'gridYAxisColor', 'gridZAxisColor', 'gridAxisColor', 'planeTopColor', 'planeFrontColor', 'planeRightColor', 'planeCustomColor',
  'planeLabelColor', 'floorColor', 'sketchStrokeColor', 'selectionColor', 'hoverColor',
  'emissiveColor', 'ambientSkyColor', 'ambientGroundColor', 'keyLightColor', 'fillLightColor', 'rimLightColor',
] as const;
export type AdvancedNumberKey = keyof typeof advancedNumberRanges;
export type AdvancedColorKey = typeof advancedColorKeys[number];
export type CADAdvancedAppearance = Partial<Record<AdvancedNumberKey, number>> & Partial<Record<AdvancedColorKey, string>> & {
  colorTransform?: 'standard' | 'filmic'; backgroundMode?: 'solid' | 'gradient'; planeLabelsVisible?: boolean; studioReflections?: boolean;
};
export type AdvancedAppearanceKey = keyof CADAdvancedAppearance;
export const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function advancedValue(key: string, value: unknown): string | number | boolean | undefined {
  if (Object.hasOwn(advancedNumberRanges, key)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const [min, max] = advancedNumberRanges[key as AdvancedNumberKey];
    const clamped = Math.max(min, Math.min(max, value));
    return key === 'gridMajorEvery' ? Math.round(clamped) : Number(clamped.toFixed(6));
  }
  if ((advancedColorKeys as readonly string[]).includes(key)) return validColor(value) ? value.toLowerCase() : undefined;
  if (key === 'colorTransform') return value === 'standard' || value === 'filmic' ? value : undefined;
  if (key === 'backgroundMode') return value === 'solid' || value === 'gradient' ? value : undefined;
  if (key === 'planeLabelsVisible' || key === 'studioReflections') return typeof value === 'boolean' ? value : undefined;
}
export function cleanAdvancedAppearance(input: Record<string, unknown>): CADAdvancedAppearance {
  const result: Record<string, unknown> = {};
  for (const key of [...Object.keys(advancedNumberRanges), ...advancedColorKeys, 'colorTransform', 'backgroundMode', 'planeLabelsVisible', 'studioReflections']) {
    const value = advancedValue(key, input[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}
