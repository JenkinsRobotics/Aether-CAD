import {cadSelection} from '../cad-selection-store';
import type {Control, FeatureEditorContext} from './shared';
import {referencePickerLifecycle,activateAvailableReferencePicker as activateAvailable} from './reference-picker-lifecycle';
/** Shared selection lifecycle; geometry and reference identity come from native picks. */
export function planarFacePicker(context:FeatureEditorContext, control:Control, title:string, accept?:(reference:any)=>string|null){
 return facePicker(context,control,title,accept,false);
}
export function extrusionFacePicker(context:FeatureEditorContext,control:Control,title:string){
 return facePicker(context,control,title,undefined,true);
}
function facePicker(context:FeatureEditorContext, control:Control, title:string, accept:((reference:any)=>string|null)|undefined, curved:boolean){
 const eventName=curved?'aether-extrude-face':'aether-sketch-face',kind=curved?'stopping face':'planar face';
 const {win,form,feature}=context;
 control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
 const container=document.createElement('div');
 const box=win.entitiesBox(title);container.append(box.element);win.body.append(container);
 const read=()=>control.value?JSON.parse(control.value):null;
 const clear=()=>{control.value='';cadSelection.dispatch({type:'clear'});render();control.dispatchEvent(new Event('change'));};
 const render=()=>{const reference=read();box.render(reference?[{label:reference.label,onRemove:clear}]:[]);button.textContent=reference?'Change face':'Use selected face';};
 let enabled=false,active=false;
 const lifecycle=referencePickerLifecycle('face',()=>enabled&&win.panel.isConnected,value=>{
  active=value;container.dataset.picking=String(active);button.setAttribute('aria-pressed',String(active));
  box.element.style.outline=active?'1px solid var(--aui-accent, #3576e8)':'';
 });
 const setActive=lifecycle.setActive;
 container.addEventListener('pointerdown',()=>{if(enabled)setActive(true);});
 const request=()=>{
  if(!enabled||!active||!win.panel.isConnected)return;
  const items=cadSelection.snapshot().items;
  if(items.length!==1||items[0].kind!=='face'){win.setError(`Select exactly one ${kind}.`);return;}
  window.dispatchEvent(new CustomEvent(eventName+'-request',{detail:{beforeFeatureId:feature?.id}}));
 };
 const receive=(event:Event)=>{
  if(!enabled||!active||!win.panel.isConnected)return;
  const result=(event as CustomEvent).detail;
  const error=!result?.support ? result?.error??`Select a ${kind}.` : accept?.(result.support);
  if(error){control.value='';render();control.dispatchEvent(new Event('change'));win.setError(error);return;}
  control.value=JSON.stringify(result.support);render();control.dispatchEvent(new Event('change'));
 };
 window.addEventListener(eventName,receive);
 const button=document.createElement('button');button.type='button';button.className='aui-button';button.setAttribute('aria-label',title+' selection');button.onclick=()=>{setActive(true);if(read())clear();else request();};container.append(button);
 let lastItems=cadSelection.snapshot().items;
 const unsubscribe=cadSelection.subscribe(()=>{const items=cadSelection.snapshot().items;if(items===lastItems)return;lastItems=items;if(enabled&&active&&items.length===1&&items[0].kind==='face')request();});
 const setEnabled=(value:boolean)=>{
  container.hidden=!value;
  if(value===enabled){activateAvailable();return;}enabled=value;
  setActive(enabled);activateAvailable();
 };
 const observer=new window.MutationObserver(()=>{if(win.panel.isConnected)return;observer.disconnect();unsubscribe();window.removeEventListener(eventName,receive);lifecycle.dispose();});
 observer.observe(document.body,{childList:true,subtree:true});
 render();return {read,request,setEnabled,element:container};
}
