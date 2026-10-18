import { cadAppearance, normalizeCADAppearance, type CADAppearanceSnapshot } from './cad-appearance-store';
import { resolveAppearance } from './viewport/appearance-themes';
import { readViewportThemeOverride } from './viewport/suite-viewport-theme';
const KEY = 'aether-cad-environment-presets-v1';
export interface EnvironmentPreset { id: string; name: string; appearance: CADAppearanceSnapshot }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Capture the effective palette so a later suite-theme change does not alter
 * what the user saved. Geometry, document units and camera are never included. */
export function captureEnvironment(snapshot = cadAppearance.snapshot()): CADAppearanceSnapshot {
  const r = resolveAppearance(snapshot, readViewportThemeOverride());
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  return normalizeCADAppearance({ ...snapshot, activePresetId: undefined, environmentTheme: 'custom',
    backgroundColor: hex(r.background), gridMinorColor: hex(r.gridMinor), gridMajorColor: hex(r.gridMajor),
    gridMinorOpacityPercent: r.gridOpacity * 100, gridMajorOpacityPercent: r.grid.majorOpacity * 100, gridAxisOpacityPercent: r.grid.axisOpacity * 100,
    gridXAxisColor: hex(r.grid.xColor), gridYAxisColor: hex(r.grid.yColor), gridZAxisColor: hex(r.grid.zColor),
    gridAxisColor: hex(r.grid.axisColor), sketchStrokeColor: hex(r.sketchStroke),
    colorTransform:r.colorTransform, backgroundMode:r.backgroundMode, backgroundBottomColor:hex(r.backgroundBottom),
    gridSpacingMillimeters:r.grid.spacing, gridExtentMillimeters:r.grid.extent, gridMajorEvery:r.grid.majorEvery,
    gridMinorWidthPx:r.grid.minorWidth, gridMajorWidthPx:r.grid.majorWidth, gridAxisWidthPx:r.grid.axisWidth,
    planeTopColor:hex(r.planeTheme.colors.top), planeFrontColor:hex(r.planeTheme.colors.front), planeRightColor:hex(r.planeTheme.colors.right), planeCustomColor:hex(r.planeTheme.colors.custom),
    planeFillOpacityPercent:r.planeTheme.style.fillOpacity*100, planeBorderOpacityPercent:r.planeTheme.style.borderOpacity*100,
    planeBorderWidthPx:r.planeTheme.style.borderWidthPx, planeLabelColor:r.planeTheme.style.labelColor, planeLabelOpacityPercent:r.planeTheme.style.labelOpacity*100,
    planeLabelsVisible:r.planeTheme.style.labelsVisible, planeSizeMillimeters:r.planeTheme.style.sizeMillimeters,
    edgeColor:hex(r.edgeColor), edgeOpacityPercent:r.edgeOpacity*100, edgeWidthPx:r.edgeWidth,
    sketchLineWidthPx:r.sketchLineWidth, sketchGridSpacingMillimeters:r.sketchGridSpacing,
    bodyColor:hex(r.bodyColor), bodyOpacityPercent:r.bodyOpacity*100, roughness:r.finish.roughness, metalness:r.finish.metalness,
    selectionColor:hex(r.selectionColor), hoverColor:hex(r.hoverColor), floorColor:hex(r.floorColor), floorOpacityPercent:r.floorOpacity*100, floorRoughness:r.floorRoughness,
    keyLightAzimuthDegrees:r.lights.keyAzimuth, keyLightElevationDegrees:r.lights.keyElevation,
    fillLightAzimuthDegrees:r.lights.fillAzimuth, fillLightElevationDegrees:r.lights.fillElevation,
    rimLightAzimuthDegrees:r.lights.rimAzimuth, rimLightElevationDegrees:r.lights.rimElevation,
    studioReflections:snapshot.studioReflections??true, reflectionIntensityPercent:snapshot.reflectionIntensityPercent??45, reflectionRotationDegrees:snapshot.reflectionRotationDegrees??0,
    emissiveColor:hex(r.emissiveColor), emissiveIntensity:r.emissiveIntensity, renderScale:snapshot.renderScale??1,
    exposure:r.exposure, ambientSkyColor:hex(r.lights.sky), ambientGroundColor:hex(r.lights.ground),
    keyLightColor:hex(r.lights.keyColor), fillLightColor:hex(r.lights.fillColor), rimLightColor:hex(r.lights.rimColor),
    ambientLightPercent:snapshot.ambientLightPercent??100, keyLightPercent:snapshot.keyLightPercent??100,
    fillLightPercent:snapshot.fillLightPercent??100, rimLightPercent:snapshot.rimLightPercent??100,
  });
}
export class EnvironmentPresetStore {
  private items: readonly EnvironmentPreset[] = [];
  private listeners = new Set<() => void>();
  constructor(private storage?: StorageLike) {
    try {
      const input = JSON.parse(storage?.getItem(KEY) ?? '[]');
      if (Array.isArray(input)) {
        const seen = new Set<string>();
        this.items = input.slice(0,50).flatMap(item => {
          if (!item || typeof item.id !== 'string' || item.id.length > 100 || seen.has(item.id) || typeof item.name !== 'string' || !item.name.trim()) return [];
          seen.add(item.id); return [{ id:item.id, name:item.name.trim().slice(0,80), appearance:normalizeCADAppearance(item.appearance) }];
        });
      }
    } catch { /* Invalid device settings must not prevent CAD startup. */ }
  }
  snapshot = () => this.items;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  save(name: string, appearance: CADAppearanceSnapshot, id?: string): string {
    const title = name.trim().slice(0,80);
    if (!title) throw Error('Enter a preset name.');
    if (this.items.some(item => item.id !== id && item.name.toLocaleLowerCase() === title.toLocaleLowerCase())) throw Error('That name already exists. Choose the preset and use Update saved preset.');
    if (!id && this.items.length >= 50) throw Error('Delete an unused preset before saving another (50 maximum).');
    const preset = { id: id ?? crypto.randomUUID(), name: title, appearance: normalizeCADAppearance(appearance) };
    this.persist([...this.items.filter(item => item.id !== id), preset]); return preset.id;
  }
  remove(id: string) { this.persist(this.items.filter(item => item.id !== id)); }
  private persist(items: readonly EnvironmentPreset[]) {
    if (!this.storage) throw Error('Browser storage is unavailable. Presets cannot be saved on this device.');
    try { this.storage.setItem(KEY, JSON.stringify(items)); } catch { throw Error('Could not save the preset. Browser storage is unavailable or full.'); }
    this.items = items; this.listeners.forEach(fn => fn());
  }
}
function deviceStorage() { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } }
export const cadEnvironmentPresets = new EnvironmentPresetStore(deviceStorage());
