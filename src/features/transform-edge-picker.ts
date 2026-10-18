import {cadSelection} from '../cad-selection-store';
import {referencePickerLifecycle,activateAvailableReferencePicker} from './reference-picker-lifecycle';
import type {Control,FeatureEditorContext} from './shared';

/** Pick native source geometry; the renderer does not manufacture edge identities. */
export function transformEdgePicker(context:FeatureEditorContext,control:Control) {
 const {win,form,feature}=context;
 control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
 const box=win.entitiesBox('Transform solid edge'),element=document.createElement('div');element.append(box.element);win.body.append(element);
 let enabled=false,active=false;
 const render=()=>{const ref=control.value?JSON.parse(control.value):undefined;box.render(ref?[{label:ref.label,onRemove:()=>set('')}]:[]);};
 const set=(value:string)=>{control.value=value;render();control.dispatchEvent(new Event('change'));};
 const button=document.createElement('button');button.type='button';button.className='aui-button';button.textContent='Select straight edge';button.setAttribute('aria-label','Transform edge selection');element.append(button);
 const lifecycle=referencePickerLifecycle('edge',()=>enabled&&win.panel.isConnected,value=>{active=value;button.setAttribute('aria-pressed',String(value));window.dispatchEvent(new CustomEvent('aether-source-edge-picking',{detail:value}));});
 const request=()=>{
  if(!enabled||!active||!win.panel.isConnected)return;
  const items=cadSelection.snapshot().items;
  if(items.length!==1||items[0].kind!=='edge'){win.setError('Select one straight edge on an earlier solid part.');return;}
  window.dispatchEvent(new CustomEvent('aether-transform-edge-request',{detail:{beforeFeatureId:feature?.id}}));
 };
 button.onclick=()=>{lifecycle.setActive(true);request();};element.addEventListener('pointerdown',()=>{if(enabled)lifecycle.setActive(true);});
 const receive=(event:Event)=>{
  if(!enabled||!active||!win.panel.isConnected)return;
  const result=(event as CustomEvent).detail;
  if(!result?.reference){win.setError(result?.error??'Select a straight solid edge.');return;}
  set(JSON.stringify(result.reference));
 };
 window.addEventListener('aether-transform-edge',receive);
 let items=cadSelection.snapshot().items;
 const unsubscribe=cadSelection.subscribe(()=>{const next=cadSelection.snapshot().items;if(next===items)return;items=next;if(items.length===1&&items[0].kind==='edge')request();});
 const note=document.createElement('p');note.className='cad-form-note';note.textContent='Follows the selected straight edge and its endpoints. A deleted, curved or ambiguous edge requires reselection.';element.append(note);
 const observer=new window.MutationObserver(()=>{if(win.panel.isConnected)return;observer.disconnect();unsubscribe();window.removeEventListener('aether-transform-edge',receive);lifecycle.dispose();});observer.observe(document.body,{childList:true,subtree:true});
 render();return{element,setEnabled:(value:boolean)=>{element.hidden=!value;if(enabled!==value){enabled=value;lifecycle.setActive(value);}activateAvailableReferencePicker();}};
}
