import {identifyProfileContours,type ExtrusionPointReference} from '@aether/core/document';
import {cadSelection} from '../cad-selection-store';
import {extrusionSketchPoints} from '../modeling/extrude-point-reference';
import {activateAvailableReferencePicker,referencePickerLifecycle} from './reference-picker-lifecycle';
import {rowIn,type Control,type FeatureEditorContext} from './shared';

export function serializeExtrusionPoint(value:string,context:FeatureEditorContext):ExtrusionPointReference {
  const ref=JSON.parse(value);
  if(ref.kind!=='sketch-choice')return ref;
  const identified=identifyProfileContours(context.doc,ref.sourceFeatureId);
  context.doc.features=identified.features;
  const point=extrusionSketchPoints(context.doc,context.feature?.id).find(p=>p.sourceFeatureId===ref.sourceFeatureId&&p.contourIndex===ref.contourIndex&&p.index===ref.index);
  if(!point?.contourId||(point.point==='vertex'&&!point.vertexId))throw Error('Reselect the stopping sketch point.');
  return {kind:'sketch-point',sourceFeatureId:point.sourceFeatureId,contourId:point.contourId,point:point.point,
    ...(point.point==='vertex'?{vertexId:point.vertexId}:{}),label:point.label};
}

export function extrusionPointPicker(context:FeatureEditorContext,control:Control,title:string,noteText='Stops at a plane through this point, parallel to the sketch. Changed or ambiguous vertices require reselection.') {
  const {win,form,doc,feature}=context;
  control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
  const element=document.createElement('div'),box=win.entitiesBox(title);
  element.append(box.element);win.body.append(element);
  const select=document.createElement('select');select.setAttribute('aria-label',title+' sketch point');
  const empty=document.createElement('option');empty.value='';empty.textContent='Choose a sketch point';select.append(empty);
  for(const point of extrusionSketchPoints(doc,feature?.id)){
    const option=document.createElement('option');option.value=JSON.stringify({kind:'sketch-choice',sourceFeatureId:point.sourceFeatureId,contourIndex:point.contourIndex,index:point.index,label:point.label});option.textContent=point.label;select.append(option);
  }
  let enabled=false,active=false;
  const read=()=>control.value?JSON.parse(control.value):undefined;
  const render=()=>{const ref=read();box.render(ref?[{label:ref.label,onRemove:()=>set('')}]:[]);};
  const set=(value:string)=>{control.value=value;select.value='';render();control.dispatchEvent(new Event('change'));};
  select.onchange=()=>{if(select.value)set(select.value);};element.append(rowIn('Sketch point',select));
  const button=document.createElement('button');button.type='button';button.className='aui-button';button.textContent='Select vertex';button.setAttribute('aria-label',title+' selection');element.append(button);
  const lifecycle=referencePickerLifecycle('vertex',()=>enabled&&win.panel.isConnected,value=>{active=value;window.dispatchEvent(new CustomEvent('aether-source-vertex-picking',{detail:value}));button.setAttribute('aria-pressed',String(value));element.dataset.picking=String(value);});
  element.addEventListener('pointerdown',()=>{if(enabled)lifecycle.setActive(true);});
  const request=()=>{
    if(!enabled||!active||!win.panel.isConnected)return;
    const items=cadSelection.snapshot().items;
    if(items.length!==1||items[0].kind!=='vertex'){win.setError('Select one vertex on an earlier part, or choose a sketch point.');return;}
    window.dispatchEvent(new CustomEvent('aether-extrude-point-request',{detail:{beforeFeatureId:feature?.id}}));
  };
  button.onclick=()=>{lifecycle.setActive(true);request();};
  const receive=(event:Event)=>{
    if(!enabled||!active||!win.panel.isConnected)return;
    const result=(event as CustomEvent).detail;
    if(!result?.reference){win.setError(result?.error??'Select a vertex on an earlier solid.');return;}
    set(JSON.stringify(result.reference));
  };
  window.addEventListener('aether-extrude-point',receive);
  let items=cadSelection.snapshot().items;
  const unsubscribe=cadSelection.subscribe(()=>{const next=cadSelection.snapshot().items;if(next===items)return;items=next;if(items.length===1&&items[0].kind==='vertex')request();});
  const note=document.createElement('p');note.className='cad-form-note';note.textContent=noteText;element.append(note);
  const observer=new window.MutationObserver(()=>{if(win.panel.isConnected)return;observer.disconnect();unsubscribe();window.removeEventListener('aether-extrude-point',receive);lifecycle.dispose();});observer.observe(document.body,{childList:true,subtree:true});
  render();return {element,setEnabled:(value:boolean)=>{element.hidden=!value;if(enabled!==value){enabled=value;lifecycle.setActive(value);}activateAvailableReferencePicker();}};
}
