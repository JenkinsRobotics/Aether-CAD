import type {FaceTransform} from '@aether/core/document';
import {transformReferenceControls,layoutTransformReferences,validateTransformReferences,serializeTransformReference} from './part-transform-reference';
import {mountTransformHandles} from './part-transform-handles';
import {layoutParameterRows,type Controls,type FeatureEditorContext} from './shared';
const vector=(v:Record<string,string>,prefix:string):[number,number,number]=>[Number(v[prefix+'X']),Number(v[prefix+'Y']),Number(v[prefix+'Z'])];
export function faceTransformControls(context:FeatureEditorContext):Controls {
 const {field,feature}=context,t=feature?.transform as FaceTransform|undefined;
 const controls:Controls={mode:field('Face operation',t?.kind??'offset',['offset','translate','translate-reference','rotate','rotate-reference']),offsetDistance:field('Offset (mm)',String(feature?.distanceMillimeters??1)),...transformReferenceControls(context),angle:field('Angle (degrees)',String(t?.kind==='rotate'||t?.kind==='rotate-reference'?t.angleDegrees:15))};
 for(const[prefix,label,values,suffix]of [['move','Translation',t?.kind==='translate'?t.translationMillimeters:[0,0,1],' (mm)'],['origin','Axis origin',t?.kind==='rotate'?t.axisOriginMillimeters:[0,0,0],' (mm)'],['axis','Axis direction',t?.kind==='rotate'?t.axisDirection:[1,0,0],'']] as const)
  for(const[i,axis]of ['X','Y','Z'].entries())controls[prefix+axis]=field(`${label} ${axis}${suffix}`,String(values[i]));
 return controls;
}
export function layoutFaceTransforms(context:FeatureEditorContext,c:Controls) {
 const names:Record<string,string>={offset:'Offset',translate:'Translate XYZ','translate-reference':'Translate by reference',rotate:'Rotate','rotate-reference':'Rotate about reference'};
 for(const option of (c.mode as HTMLSelectElement).options)option.textContent=names[option.value];
 layoutParameterRows(context,control=>[c.referenceEdge,c.fromPoint,c.toPoint,c.centerPoint].includes(control));
 const render=()=>{for(const key of ['offsetDistance','angle','moveX','moveY','moveZ','originX','originY','originZ','axisX','axisY','axisZ']){
  const visible=key==='offsetDistance'?c.mode.value==='offset':key==='angle'?c.mode.value.startsWith('rotate'):key.startsWith('move')?c.mode.value==='translate':c.mode.value==='rotate';
  const row=c[key].closest<HTMLElement>('.aui-feature-row');if(row)row.hidden=!visible;
 }};
 c.mode.addEventListener('change',render);render();layoutTransformReferences(context,c);
 mountTransformHandles(context.win.panel,c,context.lengthUnitLabel,context.angleUnitLabel);
}
export function validateFaceTransform(c:Controls):string|null {
 if(c.mode.value==='offset')return !c.offsetDistance.value.trim()||!Number.isFinite(Number(c.offsetDistance.value))||Math.abs(Number(c.offsetDistance.value))<1e-6?'Enter a finite nonzero offset.':null;
 const error=validateTransformReferences(c);if(error)return error;
 const keys=c.mode.value==='translate'?['moveX','moveY','moveZ']:c.mode.value==='rotate'?['originX','originY','originZ','axisX','axisY','axisZ','angle']:c.mode.value==='rotate-reference'?['angle']:[];
 if(keys.some(k=>!c[k].value.trim()||!Number.isFinite(Number(c[k].value))))return 'Enter finite face movement values.';
 if(c.mode.value==='rotate'&&Math.hypot(...['axisX','axisY','axisZ'].map(k=>Number(c[k].value)))<1e-12)return 'Choose a nonzero rotation axis.';
 return null;
}
export function serializeFaceTransform(v:Record<string,string>,context:FeatureEditorContext) {
 if(v.mode==='offset')return{distanceMillimeters:Number(v.offsetDistance)};
 let transform:FaceTransform;
 if(v.mode==='translate-reference')transform={kind:'translate-reference',reference:serializeTransformReference(v,context),...(v.useDistance==='yes'?{distanceMillimeters:Number(v.distance)}:{}),...(v.reverseReference==='yes'?{reversed:true}:{})};
 else if(v.mode==='rotate-reference')transform={kind:'rotate-reference',reference:serializeTransformReference(v,context),angleDegrees:Number(v.angle)};
 else if(v.mode==='translate')transform={kind:'translate',translationMillimeters:vector(v,'move')};
 else{const axis=vector(v,'axis'),length=Math.hypot(...axis);transform={kind:'rotate',axisOriginMillimeters:vector(v,'origin'),axisDirection:axis.map(n=>n/length) as [number,number,number],angleDegrees:Number(v.angle)};}
 return{transform};
}
