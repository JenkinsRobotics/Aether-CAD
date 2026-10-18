import {expect,it} from 'vitest';
import {MaterialPresetStore,renderMaterials,normalizeMaterial,matchesMaterial,materialValues} from './cad-render-materials';
import {resolveAppearance} from './viewport/appearance-themes';
import {defaultCADAppearance} from './cad-appearance-store';
import {resolvePartDisplay} from './viewport/part-display';
import {renderPixelRatio} from './viewport/render-resolution';
it('every library recipe is valid and resolves without modifying neighboring parts',()=>{
 const base=resolveAppearance(defaultCADAppearance);
 for(const preset of renderMaterials){expect(normalizeMaterial(preset.values)).toEqual(preset.values);expect(materialValues(resolvePartDisplay(base,preset.values))).toEqual(preset.values);}
 expect(materialValues(base).emissiveIntensity).toBe(0);
});
it('saves exact custom colors and finish across reload, validates and handles storage failure atomically',()=>{
 let saved='[]';const storage={getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
 const store=new MaterialPresetStore(storage),values={...renderMaterials[0].values,roughness:.13};
 const id=store.save('My ABS',values);expect(new MaterialPresetStore(storage).snapshot()[0].values).toEqual(values);
 expect(()=>store.save('MY ABS',values)).toThrow('already exists');
 expect(()=>store.save('Broken',{...values,opacity:NaN})).toThrow();
 storage.setItem=()=>{throw Error('quota');};expect(()=>store.remove(id)).toThrow('Could not save');expect(store.snapshot()).toHaveLength(1);
});
it('ignores malformed stored recipes, caps rendering allocations and compares effective material fields only',()=>{
 const store=new MaterialPresetStore({getItem:()=>JSON.stringify([{id:'custom:x',name:'Bad',values:{color:'red'}}]),setItem:()=>{}});
 expect(store.snapshot()).toEqual([]);expect(renderPixelRatio(1.5,4)).toBe(3);expect(renderPixelRatio(.1,1)).toBe(.5);expect(renderPixelRatio(NaN,NaN)).toBe(1);
 const a=renderMaterials[0].values;expect(matchesMaterial(a,{...a,roughness:a.roughness+1e-9})).toBe(true);expect(matchesMaterial(a,{...a,metalness:.7})).toBe(false);
});

it('creates a finite local reflection map with contrasting soft light panels',async()=>{
 const {createStudioReflectionMap,rotateStudioReflectionMap}=await import('./viewport/studio-reflections');
 const texture=createStudioReflectionMap(),data=texture.image.data as Float32Array;
 expect(texture.image.width).toBe(128);expect(texture.image.height).toBe(64);
 expect([...data].every(Number.isFinite)).toBe(true);
 const values=Array.from(data).filter((_,i)=>i%4===0);expect(Math.max(...values)-Math.min(...values)).toBeGreaterThan(1);
 const original=data.slice(),version=texture.pmremVersion;
 rotateStudioReflectionMap(texture,90);expect(texture.pmremVersion).toBe(version+1);
 expect(data).not.toEqual(original);
 rotateStudioReflectionMap(texture,450);expect(texture.pmremVersion).toBe(version+1);
 rotateStudioReflectionMap(texture,360);expect(data).toEqual(original);
 texture.dispose();
});
