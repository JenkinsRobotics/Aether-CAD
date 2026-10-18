import type {ExtrusionPreviewAxis} from '@aether/core/contracts';

/** Optional renderer hints cannot smuggle non-finite coordinates into a drag. */
export function readExtrusionPreviewAxes(value:unknown):ExtrusionPreviewAxis[]|undefined {
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>2)return [];
 const sides=new Set();
 const vector=(v:unknown):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9);
 for(const axis of value){
  if(!axis||!['primary','opposite'].includes(axis.side)||sides.has(axis.side)||!['distance','second'].includes(axis.parameter)||
   (axis.parameter==='second'&&(axis.side!=='opposite'||axis.scale!==1))||![1,.5].includes(axis.scale)||typeof axis.reversed!=='boolean'||
   !vector(axis.originMillimeters)||!vector(axis.direction)||Math.abs(Math.hypot(...axis.direction)-1)>1e-6)return [];
  sides.add(axis.side);
 }
 return structuredClone(value);
}
