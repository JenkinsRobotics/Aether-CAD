import {validateTransform,type NumericPartTransform} from '@aether/core/document';
import type {TransformPreviewFrame} from '@aether/core/contracts';

/** An optional display anchor is never allowed to create a nonfinite drag. */
export function readTransformPreviewFrame(value:unknown):TransformPreviewFrame|undefined {
 if(!value||typeof value!=='object')return undefined;
 const v=value as {center_mm?:unknown;radius_mm?:unknown;resolved_transform?:unknown;reference_direction?:unknown};
 if(!Array.isArray(v.center_mm)||v.center_mm.length!==3||!v.center_mm.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9)||typeof v.radius_mm!=='number'||!Number.isFinite(v.radius_mm)||v.radius_mm<=0||v.radius_mm>1e9)return undefined;
 let resolvedTransform:NumericPartTransform|undefined;
 if(v.resolved_transform!==undefined){
  const t=v.resolved_transform as NumericPartTransform;
  try{if(!['translate','rotate','scale'].includes(t?.kind))return undefined;validateTransform({id:'preview',type:'transform',name:'Preview',suppressed:false,bodyIds:['preview'],transform:t});resolvedTransform=structuredClone(t);}catch{return undefined;}
 }
 const direction=v.reference_direction;
 if(direction!==undefined&&(!Array.isArray(direction)||direction.length!==3||!direction.every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(Math.hypot(...direction)-1)>1e-6))return undefined;
 return {...(resolvedTransform?{resolvedTransform}:{}),...(direction?{referenceDirection:[...direction as number[]] as [number,number,number]}:{}),centerMillimeters:[...v.center_mm] as [number,number,number],radiusMillimeters:v.radius_mm};
}
