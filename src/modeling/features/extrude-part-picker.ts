import {availableBodies,bodyIDsForFeature} from '@aether/core/document';
import {mountPartBox} from './part-box';
import type {Control,FeatureEditorContext} from './shared';
import {activateAvailableReferencePicker, referencePickerLifecycle} from './reference-picker-lifecycle';

/** The stopping part of an Up-to-part extent: a pick box filled by selecting a part in the viewport or tree. */
export function extrusionPartPicker(context:FeatureEditorContext,control:Control,title:string) {
 const {doc,feature,win}=context;
 const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
 const prior={...doc,features:doc.features.slice(0,end),rollbackIndex:undefined};
 const meshes=new Set(prior.features.flatMap(f=>f.type==='import-cad'&&f.meshMode==='reference'?bodyIDsForFeature(prior,f):[]));
 let enabled=false,active=false;
 const box=mountPartBox(context,control,title,availableBodies(prior).filter(b=>!meshes.has(b.id)),()=>'',{single:true,scalar:true,isActive:()=>active});
 const lifecycle=referencePickerLifecycle('body',()=>enabled&&win.panel.isConnected,value=>{
  active=value;box.element.dataset.picking=String(value);
  window.dispatchEvent(new CustomEvent('aether-source-body-picking',{detail:value}));
 });
 box.element.tabIndex=0;
 const activate=()=>{if(enabled)lifecycle.setActive(true);};
 box.element.addEventListener('pointerdown',activate);box.element.addEventListener('focusin',activate);
 const observer=new window.MutationObserver(()=>{if(win.panel.isConnected)return;observer.disconnect();lifecycle.dispose();});
 observer.observe(document.body,{childList:true,subtree:true});
 const note=document.createElement('p');note.textContent='The entire extrusion must stop against this part. Curved boundaries are supported. Missing or changed parts require repair.';win.addHelp(note);
 return {element:box.element,setEnabled:(value:boolean)=>{
  box.element.hidden=!value;note.hidden=!value;
  if(enabled!==value){enabled=value;lifecycle.setActive(value);}
  activateAvailableReferencePicker();
 }};
}
