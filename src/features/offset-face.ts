import {faceTransformControls,layoutFaceTransforms,validateFaceTransform,serializeFaceTransform} from './face-transform-controls';
import type {SolidFaceReference} from '@aether/core/document';
import {cadSelection} from '../cad-selection-store';
import {referencePickerLifecycle} from './reference-picker-lifecycle';
import {mountNativeExtrusionHandles} from './extrude-native-handles';
import type {FeatureEditor} from './shared';

const identity=(face:SolidFaceReference)=>JSON.stringify([face.sourceFeatureId,face.bodyId,face.normal,face.surfaceType,face.faceAnchor]);
export const offsetFaceEditor:FeatureEditor={
 type:'offset-face',
 controls(context) {
  return {faces:context.field('Offset face references',JSON.stringify(context.feature?.faces??[])),...faceTransformControls(context)};
 },
 layout(context,controls){
  const {win,form,feature,lengthUnitLabel}=context;
  const field=controls.faces;field.closest('label')?.remove();field.hidden=true;field.setAttribute('form',form.id);form.append(field);
  const box=win.entitiesBox('Faces to move');win.body.prepend(box.element);
  const read=():SolidFaceReference[]=>JSON.parse(field.value);
  const update=(faces:SolidFaceReference[])=>{field.value=JSON.stringify(faces);render();field.dispatchEvent(new Event('change'));};
  const render=()=>box.render(read().map((face,index)=>({label:face.label,onRemove:()=>{cadSelection.dispatch({type:'clear'});update(read().filter((_,i)=>i!==index));}})));
  const add=document.createElement('button');add.type='button';add.className='aui-button';add.textContent='Add selected faces';add.setAttribute('aria-label','Add offset faces');box.element.append(add);
  const clear=document.createElement('button');clear.type='button';clear.className='aui-button';clear.textContent='Clear faces';clear.onclick=()=>{cadSelection.dispatch({type:'clear'});update([]);};box.element.append(clear);
  let active=false;
  const lifecycle=referencePickerLifecycle('face',()=>win.panel.isConnected,value=>{active=value;box.element.dataset.picking=String(value);window.dispatchEvent(new CustomEvent("aether-source-face-picking",{detail:value}));});
  const request=()=>{if(!active||!win.panel.isConnected)return;window.dispatchEvent(new CustomEvent('aether-offset-faces-request',{detail:{beforeFeatureId:feature?.id}}));};
  add.onclick=()=>{lifecycle.setActive(true);request();};
  box.element.addEventListener('pointerdown',()=>lifecycle.setActive(true));
  const receive=(event:Event)=>{
   if(!active||!win.panel.isConnected)return;
   const reply=(event as CustomEvent).detail;
   if(!reply?.faces?.length){win.setError(reply?.error??'Select one or more native faces.');return;}
   const faces=read(),known=new Set(faces.map(identity));
   for(const face of reply.faces){if(!known.has(identity(face))){faces.push(face);known.add(identity(face));}}
   update(faces);
  };
  window.addEventListener('aether-offset-faces',receive);
  let selected=cadSelection.snapshot().items;
  const unsubscribe=cadSelection.subscribe(()=>{const next=cadSelection.snapshot().items;if(next===selected)return;selected=next;if(next.length&&next.every(item=>item.kind==='face'))request();});
  const note=document.createElement('p');note.className='cad-form-note';note.textContent='Select faces on one or more parts. Offset follows their surface normals. Translate and Rotate extend neighboring surfaces to meet moved planar faces; all faces of a solid can move together. Curved-face relocation, disappearing boundaries and fillet reapplication remain unavailable.';win.body.append(note);
  mountNativeExtrusionHandles(win.panel,{...controls,distance:controls.offsetDistance},lengthUnitLabel,{signed:true,label:'Drag face offset'});
  const observer=new window.MutationObserver(()=>{if(win.panel.isConnected)return;observer.disconnect();unsubscribe();window.removeEventListener('aether-offset-faces',receive);lifecycle.dispose();});
  observer.observe(document.body,{childList:true,subtree:true});render();lifecycle.setActive(true);layoutFaceTransforms(context,controls);
  if(!feature&&selected.length&&selected.every(item=>item.kind==='face'))queueMicrotask(request);
 },
 validate(controls){
  if(!JSON.parse(controls.faces.value).length)return 'Select one or more faces to offset.';
  return validateFaceTransform(controls);
 },
 serialize(values,context){return {faces:JSON.parse(values.faces),...serializeFaceTransform(values,context)};},
};
