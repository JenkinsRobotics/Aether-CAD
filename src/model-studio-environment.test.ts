import { expect, it } from 'vitest';
import { modelStudioEnvironment as look, modelStudioSurfaces } from '@aether/assets/themes/rendering/model-studio';
import { CADAppearanceStore, normalizeCADAppearance } from './cad-appearance-store';
import { captureEnvironment, EnvironmentPresetStore } from './cad-environment-presets';
import { resolveAppearance } from './viewport/appearance-themes';
import { environmentLightDirection } from './viewport/environment-light-direction';
import { renderMaterials } from './cad-render-materials';
it('applies the shared look through ordinary CAD appearance with correct light directions and units', () => {
  const store=new CADAppearanceStore();store.dispatch({type:'apply-environment-theme',theme:'model-studio'});
  const value=store.snapshot(), r=resolveAppearance(value,{background:0xffffff,gridMinor:0xffffff});
  expect(value).toMatchObject({environmentTheme:'model-studio',lightingPreset:'model-studio',gridSpacingMillimeters:25,edgesVisible:false});
  expect(r.background).toBe(0x101112);expect(r.exposure).toBe(look.exposure);expect(r.finish).toEqual({roughness:.29,metalness:.62});
  expect(r.lights).toMatchObject({hemisphere:1.2,key:5,fill:0,rim:3,keyColor:0xfff4df,rimColor:0xb9d9ec});
  const direction=environmentLightDirection(r.lights.keyAzimuth,r.lights.keyElevation,'y');
  direction.forEach((n,i)=>expect(n/10).toBeCloseTo(look.key.direction[i]/Math.hypot(...look.key.direction),6));
  expect(normalizeCADAppearance(JSON.parse(JSON.stringify(value)))).toEqual(value);
});
it('captures, saves, reloads and reapplies the look independently of future suite palette changes', () => {
  const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  const appearance=new CADAppearanceStore();appearance.dispatch({type:'apply-environment-theme',theme:'model-studio'});
  const captured=captureEnvironment(appearance.snapshot());const store=new EnvironmentPresetStore(storage);const id=store.save('Robot studio',captured);
  const restored=new EnvironmentPresetStore(storage).snapshot()[0];expect(restored.id).toBe(id);
  appearance.dispatch({type:'apply-environment-theme',theme:'onshape'});appearance.dispatch({type:'apply-saved-preset',id,appearance:restored.appearance});
  expect(resolveAppearance(appearance.snapshot())).toEqual(resolveAppearance(captured));
});
it('adds every demo finish to the real CAD material library with matching PBR values', () => {
  for(const surface of modelStudioSurfaces) expect(renderMaterials.find(p=>p.id===surface.id)?.values).toMatchObject({color:surface.color,roughness:surface.roughness,metalness:surface.metalness});
  expect(new Set(renderMaterials.map(p=>p.id)).size).toBe(renderMaterials.length);
});

it('opens with Model Studio and resets legacy presets without leaking its custom colours', () => {
  const store=new CADAppearanceStore();
  expect(store.snapshot()).toMatchObject({environmentTheme:'model-studio',backgroundColor:'#101112',displayStyle:'shaded'});
  store.dispatch({type:'apply-environment-theme',theme:'onshape'});
  expect(store.snapshot().backgroundColor).toBe('#f2f5f7');
  expect(resolveAppearance(store.snapshot()).background).toBe(0xf2f5f7);
});

it('uses the demo grid proportions, plain thin cells and a horizon fade', () => {
  const grid = resolveAppearance(new CADAppearanceStore().snapshot()).grid;
  expect(grid.extent / grid.spacing).toBe(look.grid.extentMeters / look.grid.spacingMeters);
  expect(grid).toMatchObject({majorEvery:0,minorWidth:1,majorWidth:1,axisWidth:1,toneMapped:true,
    horizonFade:true});
});

it('upgrades the old untouched stage recipe while retaining customized grid spacing', () => {
  const old = {environmentTheme:'model-studio',gridSpacingMillimeters:1000,gridExtentMillimeters:40000};
  expect(normalizeCADAppearance(old)).toMatchObject({gridSpacingMillimeters:25,gridExtentMillimeters:1000});
  expect(normalizeCADAppearance({...old,gridSpacingMillimeters:75})).toMatchObject({gridSpacingMillimeters:75,gridExtentMillimeters:40000});
  expect(normalizeCADAppearance({...old,environmentTheme:'custom'})).toMatchObject({gridSpacingMillimeters:1000,gridExtentMillimeters:40000});
});
