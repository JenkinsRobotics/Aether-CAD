import { describe, expect, it, vi } from 'vitest';
import { CADAppearanceStore, defaultCADAppearance, normalizeCADAppearance, reduceCADAppearance } from './cad-appearance-store';
import { captureEnvironment, EnvironmentPresetStore } from './cad-environment-presets';
import { resolveAppearance } from './viewport/appearance-themes';

function storage(initial = '[]') {
  let text = initial;
  return { getItem: () => text, setItem: vi.fn((_key: string, value: string) => { text = value; }) };
}
const custom = { ...defaultCADAppearance, gridSpacingMillimeters: 12, gridMinorOpacityPercent: 100,
  planeBorderWidthPx: 4, planeFrontColor: '#ff3300', backgroundMode: 'gradient' as const,
  backgroundColor: '#123456', backgroundBottomColor: '#ffffff', keyLightPercent: 140, keyLightAzimuthDegrees: 72, keyLightElevationDegrees: 12, gridXAxisColor: '#aa0000', gridYAxisColor: '#00bb00' };

describe('custom environment persistence', () => {
  it('saves, reloads, updates and deletes a complete environment', () => {
    const device = storage(), store = new EnvironmentPresetStore(device), notify = vi.fn();
    store.subscribe(notify);
    const captured = captureEnvironment(custom);
    const id = store.save('  Workshop  ', captured);
    const reloaded = new EnvironmentPresetStore(device);
    expect(reloaded.snapshot()).toEqual([{ id, name: 'Workshop', appearance: captured }]);
    const appearance = new CADAppearanceStore();
    appearance.dispatch({ type: 'apply-saved-preset', id, appearance: reloaded.snapshot()[0].appearance });
    expect(appearance.snapshot()).toMatchObject({ ...custom, environmentTheme: 'custom', activePresetId: id });
    appearance.dispatch({ type: 'set-advanced', key: 'gridSpacingMillimeters', value: 8 });
    expect(appearance.snapshot().activePresetId).toBe(id);
    reloaded.save('Workshop', captureEnvironment(appearance.snapshot()), id);
    expect(new EnvironmentPresetStore(device).snapshot()[0].appearance.gridSpacingMillimeters).toBe(8);
    reloaded.remove(id);
    expect(new EnvironmentPresetStore(device).snapshot()).toEqual([]);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('preserves the saved appearance when suite palette defaults change', () => {
    const captured = captureEnvironment(custom);
    const before = resolveAppearance(captured);
    const after = resolveAppearance(captured, { background: 0, gridMinor: 0, gridMajor: 0, sketchStroke: 0, gridOpacityScale: .01 });
    expect(after).toEqual(before);
    expect(captureEnvironment(captured)).toEqual(captured);
  });

  it('reports failed writes without pretending a preset was saved or deleted', () => {
    const device = storage(), store = new EnvironmentPresetStore(device), notify = vi.fn();
    const id = store.save('Existing', custom); store.subscribe(notify);
    device.setItem.mockImplementation(() => { throw Error('QuotaExceeded'); });
    expect(() => store.save('New', custom)).toThrow('Could not save');
    expect(() => store.remove(id)).toThrow('Could not save');
    expect(store.snapshot().map(p => p.name)).toEqual(['Existing']);
    expect(notify).not.toHaveBeenCalled();
    expect(() => new EnvironmentPresetStore().save('Missing storage', custom)).toThrow('unavailable');
  });

  it('rejects empty/duplicate names without overwriting an existing preset', () => {
    const store = new EnvironmentPresetStore(storage()); store.save('Workshop', custom);
    expect(() => store.save(' workshop ', custom)).toThrow('already exists');
    expect(() => store.save('  ', custom)).toThrow('Enter a preset name');
    expect(store.snapshot()).toHaveLength(1);
  });

  it('tolerates corrupt storage and normalizes older or invalid appearance data', () => {
    expect(new EnvironmentPresetStore(storage('not JSON')).snapshot()).toEqual([]);
    const store = new EnvironmentPresetStore(storage(JSON.stringify([
      null, {id:'a',name:'Legacy',appearance:{gridSpacingMillimeters:0,gridMinorWidthPx:999,planeFrontColor:'bad',floorMode:'bogus'}},
      {id:'a',name:'Duplicate'}, {id:1,name:'Bad ID'}, {id:'b',name:' '},
    ])));
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0].appearance).toMatchObject({gridSpacingMillimeters:.1,gridMinorWidthPx:6,floorMode:'none'});
    expect(store.snapshot()[0].appearance.planeFrontColor).toBeUndefined();
  });
});

describe('advanced rendering state', () => {
  it('makes 100% opacity absolute even with faint suite defaults', () => {
    const result = resolveAppearance(custom, { gridOpacityScale: .02 });
    expect(result.gridOpacity).toBe(1);
    expect(result.planeTheme).toMatchObject({ colors:{front:0xff3300},style:{borderWidthPx:4} });
    expect(result.grid.spacing).toBe(12);
  });

  it('rejects nonfinite values, unknown properties and invalid colors', () => {
    const normalized = normalizeCADAppearance({ gridSpacingMillimeters:NaN, gridExtentMillimeters:Infinity, gridMajorEvery:3.8,
      keyLightPercent:-1, planeFrontColor:'url(bad)', planeTopColor:'#ABCDEF', planeLabelsVisible:'false', __unexpected:true });
    expect(normalized.gridSpacingMillimeters).toBeUndefined();
    expect(normalized.gridExtentMillimeters).toBeUndefined();
    expect(normalized.gridMajorEvery).toBe(4); expect(normalized.keyLightPercent).toBe(0);
    expect(normalized.planeFrontColor).toBeUndefined(); expect(normalized.planeTopColor).toBe('#abcdef');
    expect(normalized.planeLabelsVisible).toBeUndefined(); expect(normalized).not.toHaveProperty('__unexpected');
    expect(reduceCADAppearance(custom, {type:'set-advanced',key:'exposure',value:NaN})).toBe(custom);
  });

  it('restores full built-in presets and clears manual overrides', () => {
    const next = reduceCADAppearance(custom, {type:'apply-environment-theme',theme:'high-contrast'});
    expect(next).toMatchObject({environmentTheme:'high-contrast',background:'cad-light',floorMode:'grid',gridMinorOpacityPercent:65});
    expect(next.backgroundMode).toBeUndefined(); expect(next.gridSpacingMillimeters).toBeUndefined();
    expect(next.planeFrontColor).toBeUndefined();
    const reset = reduceCADAppearance(next, {type:'apply-environment-theme',theme:'onshape'});
    expect(reset).toMatchObject({environmentTheme:'onshape',floorMode:'none',gridMinorColor:'#84929d'});
    expect(reset.planeBorderWidthPx).toBeUndefined();
  });
});
