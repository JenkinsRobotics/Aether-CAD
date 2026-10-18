import {validateSolidEdgeReference,type SolidEdgeReference} from './solid-edge-reference';
import {validateExtrusionPointReference,type ExtrusionPointReference} from './extrusion-point-reference';
import type {SketchLineDirectionReference} from './part-document';
type Vector3=[number,number,number];
export type NumericPartTransform=
 | {kind:'translate';translationMillimeters:Vector3}
 | {kind:'rotate';axisOriginMillimeters:Vector3;axisDirection:Vector3;angleDegrees:number}
 | {kind:'scale';centerMillimeters:Vector3;scaleFactors:Vector3}
 | {kind:'copy'};
export type TransformVectorReference=SketchLineDirectionReference|SolidEdgeReference|{kind:'two-points';from:ExtrusionPointReference;to:ExtrusionPointReference};
export type PartTransform=NumericPartTransform
 | {kind:'translate-reference';reference:TransformVectorReference;distanceMillimeters?:number;reversed?:boolean}
 | {kind:'rotate-reference';reference:TransformVectorReference;angleDegrees:number}
 | {kind:'scale-reference';centerReference:ExtrusionPointReference;scaleFactors:Vector3};
export function transformReferences(t:PartTransform):Array<SketchLineDirectionReference|ExtrusionPointReference|SolidEdgeReference> {
 if(t.kind==='scale-reference')return[t.centerReference];
 if(t.kind==='translate-reference'||t.kind==='rotate-reference')return t.reference?.kind==='two-points'?[t.reference.from,t.reference.to]:[t.reference];
 return [];
}
export interface TransformFeature {
 id:string;type:'transform';name:string;suppressed:boolean;
 bodyIds:string[];
 transform:PartTransform;
 /** Stable output IDs for copies. Omitted for in-place transformations. */
 copyBodyIds?:Record<string,string>;
}
const id=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=256;
const vector=(value:unknown):value is Vector3=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
export function validateTransform(feature:TransformFeature,earlier:ReadonlyMap<string,string>=new Map(),missing:(id:string)=>boolean=()=>false) {
 const ids=feature.bodyIds,t=feature.transform,copies=feature.copyBodyIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>256||!ids.every(id)||new Set(ids).size!==ids.length)throw Error('Choose distinct solid parts to transform (up to 256).');
 if('targetBodyId' in feature||'targetBodyIds' in feature)throw Error('Transform target parts are defined by bodyIds.');
 if(copies!==undefined){
  if(!copies||typeof copies!=='object'||Array.isArray(copies)||Object.keys(copies).length!==ids.length||ids.some(key=>!Object.hasOwn(copies,key)||!id(copies[key]))||new Set(Object.values(copies)).size!==ids.length||Object.values(copies).some(key=>ids.includes(key)))throw Error('Each copied part needs a distinct new output identity.');
 }
 if(!t||typeof t!=='object'||Array.isArray(t))throw Error('Choose a valid part transform.');
 for(const ref of transformReferences(t)){
  if(ref?.kind==='sketch-line'){
   if(![ref.sourceFeatureId,ref.contourId,ref.segmentId].every(v=>id(v)&&v.length<=128)||(!missing(ref.sourceFeatureId)&&earlier.get(ref.sourceFeatureId)!=='profile'))throw Error('Transform needs a straight line in an earlier sketch.');
  }else if(ref?.kind==='solid-edge')validateSolidEdgeReference(ref,earlier,missing);
  else validateExtrusionPointReference(ref as ExtrusionPointReference,earlier,missing);
 }
 if(t.kind==='translate-reference'){
  if(t.distanceMillimeters!==undefined&&!Number.isFinite(t.distanceMillimeters))throw Error('Translation distance must be finite.');
  if(t.reversed!==undefined&&typeof t.reversed!=='boolean')throw Error('Invalid transform direction.');
 }else if(t.kind==='rotate-reference'){
  if(!Number.isFinite(t.angleDegrees))throw Error('Rotation angle must be finite.');
 }else if(t.kind==='scale-reference'){
  if(!vector(t.scaleFactors)||t.scaleFactors.some(v=>v<=0)||!Number.isFinite(t.scaleFactors.reduce((a,b)=>a*b,1))||t.scaleFactors.reduce((a,b)=>a*b,1)<=0)throw Error('Scale needs positive factors within the supported numeric range.');
 }else if(t.kind==='translate'){
  if(!vector(t.translationMillimeters))throw Error('Translation needs finite X, Y and Z distances.');
 }else if(t.kind==='rotate'){
  if(!vector(t.axisOriginMillimeters)||!vector(t.axisDirection)||Math.abs(Math.hypot(...t.axisDirection)-1)>1e-6||!Number.isFinite(t.angleDegrees))throw Error('Rotation needs a finite origin, unit axis and angle.');
 }else if(t.kind==='scale'){
  if(!vector(t.centerMillimeters)||!vector(t.scaleFactors)||t.scaleFactors.some(v=>v<=0)||!Number.isFinite(t.scaleFactors.reduce((a,b)=>a*b,1))||t.scaleFactors.reduce((a,b)=>a*b,1)<=0)throw Error('Scale needs a finite center and positive factors within the supported numeric range.');
 }else if(t.kind==='copy'){
  if(!copies)throw Error('Copy in place needs new body identities.');
 }else throw Error('Choose Translate, Rotate, Scale or Copy in place.');
}
