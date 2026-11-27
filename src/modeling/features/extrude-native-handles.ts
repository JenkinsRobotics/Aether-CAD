import type {ImportedModelData} from '@aether/core/contracts';
import {mountExtrusionHandle,type AxisProjection} from './extrude-depth-drag';
import type {Controls} from './shared';

/** Native anchors share the accepted preview's lifecycle, never saved state. */
export function mountNativeExtrusionHandles(panel:HTMLElement,controls:Controls,unit:string,options:{signed?:boolean;label?:string}={}) {
 let preview:ImportedModelData['featurePreview'];let ready=false,legacy=false;
 const receive=(event:Event)=>{
  const state=(event as CustomEvent<{model?:ImportedModelData|null;pending:boolean}>).detail;
  ready=!state.pending;
  if(!state.pending){
   preview=state.model?.featurePreview&&state.model.featurePreview.featureId===panel.dataset.featureId?state.model.featurePreview:undefined;
   legacy=!!state.model&&state.model.featurePreview?.extrusionAxes===undefined&&state.model.featurePreview?.featureId===undefined;
  }
 };
 panel.addEventListener('aether-feature-preview-state',receive);
 for(const [side,parameter,label] of [['primary','distance','Pull extrusion depth'],['opposite','distance','Pull symmetric extrusion depth'],['opposite','second','Pull opposite extrusion depth']] as const){
  const field=controls[parameter];if(!field)continue;
  const axis=()=>preview?.extrusionAxes?.find(item=>item.side===side&&item.parameter===parameter);
  mountExtrusionHandle(panel,{distance:field,reversed:controls.reversed},unit,(depth,respond)=>{
   const current=axis();if(!current)return respond(null);
   const sign=parameter==='distance'&&current.reversed?-1:1;
   window.dispatchEvent(new CustomEvent('aether-native-extrusion-handle',{detail:{origin:current.originMillimeters,direction:current.direction.map(v=>v*sign),depth:depth*current.scale,
    respond:(projection:AxisProjection|null)=>respond(projection?{...projection,depthAt:(x,y)=>{const value=projection.depthAt(x,y);return value===null?null:value/current.scale;}}:null)}}));
  },{valueMode:options.signed?'signed':parameter==='second'?'positive':'magnitude',label:options.label??label,ready:()=>ready,
    formatLabel:(value,suffix)=>`${parameter==='second'?'Opposite · ':''}${value} ${suffix}${axis()?.scale===.5?' total':''}`});
 }
 // Old workers retain the existing simple Blind handle. The old projection's
 // offset/reference/second-end guards still apply, so it cannot guess a start.
 if(!options.signed)mountExtrusionHandle(panel,controls,unit,undefined,{enabled:()=>legacy,ready:()=>ready,label:'Pull sketch extrusion depth'});
 const observer=new window.MutationObserver(()=>{if(!panel.isConnected){panel.removeEventListener('aether-feature-preview-state',receive);observer.disconnect();}});
 observer.observe(document.body,{childList:true,subtree:true});
}
