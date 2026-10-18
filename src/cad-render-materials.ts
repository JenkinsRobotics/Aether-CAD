/** Visual recipes only. Engineering density and BOM assignments are separate. */
import { modelStudioSurfaces } from '@aether/assets/themes/rendering/model-studio';
import { validColor } from './cad-advanced-appearance';
import type { ResolvedAppearance } from './viewport/appearance-themes';
export interface RenderMaterialValues {
  color: string; opacity: number; roughness: number; metalness: number;
  emissiveColor: string; emissiveIntensity: number;
}
export interface RenderMaterialPreset {
  id: string; name: string; category: string; finish: string; color: string; values: RenderMaterialValues;
}
const recipe = (id:string,name:string,category:string,finish:string,color:string,roughness:number,metalness=0,opacity=1,emissiveIntensity=0):RenderMaterialPreset => ({
  id,name,category,finish,color,values:{color,roughness,metalness,opacity,emissiveColor:emissiveIntensity?color:'#000000',emissiveIntensity},
});
export const renderMaterials: readonly RenderMaterialPreset[] = [
  ...modelStudioSurfaces.map(p => recipe(p.id, p.name, 'Model Studio', 'Studio finish', p.color, p.roughness, p.metalness)),
  recipe('abs-gloss','ABS','Plastic','Glossy','#c73545',.2),
  recipe('abs-matte','ABS','Plastic','Matte','#b73440',.8),
  recipe('nylon','Nylon','Plastic','Satin','#d5dce0',.5),
  recipe('paint','Painted finish','Plastic','Glossy','#427fa9',.22),
  recipe('aluminum','Aluminum','Metal','Brushed','#b8c2ca',.42,.85),
  recipe('steel','Steel','Metal','Polished','#a6b0ba',.18,.95),
  recipe('brass','Brass','Metal','Polished','#c7a65b',.24,.85),
  recipe('copper','Copper','Metal','Satin','#b87550',.35,.9),
  recipe('rubber','Rubber','Other','Matte','#24272b',.92),
  recipe('ceramic','Ceramic','Other','Glazed','#eeeae1',.18),
  recipe('acrylic','Clear acrylic','Transparent','Opacity preview','#c4e6ed',.12,0,.28),
  recipe('emissive','Warm light','Emissive','Self-lit','#ffd49b',.5,0,1,1.5),
];
export function materialValues(r:ResolvedAppearance):RenderMaterialValues {
  const hex=(n:number)=>`#${n.toString(16).padStart(6,'0')}`;
  return {color:hex(r.bodyColor),opacity:r.bodyOpacity,...r.finish,emissiveColor:hex(r.emissiveColor),emissiveIntensity:r.emissiveIntensity};
}
export function normalizeMaterial(input:unknown):RenderMaterialValues {
  const v=input as Partial<RenderMaterialValues> | null;
  if(!v || !validColor(v.color)||!validColor(v.emissiveColor))throw Error('Material colors must use six-digit hex values.');
  for(const key of ['opacity','roughness','metalness','emissiveIntensity'] as const){
    const n=v[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>(key==='emissiveIntensity'?5:1))throw Error(`Invalid material ${key}.`);
  }
  return {color:v.color.toLowerCase(),opacity:v.opacity!,roughness:v.roughness!,metalness:v.metalness!,emissiveColor:v.emissiveColor.toLowerCase(),emissiveIntensity:v.emissiveIntensity!};
}
export function matchesMaterial(a:RenderMaterialValues,b:RenderMaterialValues){
  return (Object.keys(a) as (keyof RenderMaterialValues)[]).every(k=>typeof a[k]==='number'?Math.abs(Number(a[k])-Number(b[k]))<1e-6:a[k]===b[k]);
}
const KEY='aether-cad-material-presets-v1';
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
export class MaterialPresetStore {
  private items:readonly RenderMaterialPreset[]=[];
  private listeners=new Set<()=>void>();
  constructor(private storage?:StorageLike){
    try{const input=JSON.parse(storage?.getItem(KEY)??'[]');const seen=new Set<string>();
      if(Array.isArray(input))this.items=input.slice(0,50).flatMap(p=>{try{
        if(typeof p.id!=='string'||!p.id.startsWith('custom:')||p.id.length>100||seen.has(p.id)||typeof p.name!=='string'||!p.name.trim())return [];
        const values=normalizeMaterial(p.values);seen.add(p.id);return [{id:p.id,name:p.name.trim().slice(0,80),category:'Custom',finish:'Saved appearance',color:values.color,values}];
      }catch{return [];}});
    }catch{/* Invalid browser data must not prevent startup. */}
  }
  snapshot=()=>this.items;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  save(name:string,input:RenderMaterialValues){
    const title=name.trim().slice(0,80);if(!title)throw Error('Enter a material name.');
    if(this.items.some(p=>p.name.toLowerCase()===title.toLowerCase()))throw Error('A material with that name already exists.');
    if(this.items.length>=50)throw Error('Remove an unused custom material first (50 maximum).');
    const values=normalizeMaterial(input),id=`custom:${crypto.randomUUID()}`;
    this.persist([...this.items,{id,name:title,category:'Custom',finish:'Saved appearance',color:values.color,values}]);return id;
  }
  remove(id:string){this.persist(this.items.filter(p=>p.id!==id));}
  private persist(items:readonly RenderMaterialPreset[]){
    if(!this.storage)throw Error('Browser storage is unavailable.');
    try{this.storage.setItem(KEY,JSON.stringify(items));}catch{throw Error('Could not save materials. Browser storage is unavailable or full.');}
    this.items=items;this.listeners.forEach(fn=>fn());
  }
}
function storage(){try{return typeof localStorage==='undefined'?undefined:localStorage;}catch{return undefined;}}
export const cadMaterialPresets=new MaterialPresetStore(storage());
