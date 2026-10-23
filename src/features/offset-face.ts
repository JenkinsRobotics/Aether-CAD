import {faceTransformControls,layoutFaceTransforms,validateFaceTransform,serializeFaceTransform} from './face-transform-controls';
import type {SolidFaceReference} from '@aether/core/document';
import {cadSelection} from '../cad-selection-store';
import {faceIdentity,mountPickedReferences} from './picked-references';
import {referencePickerLifecycle} from './reference-picker-lifecycle';
import {mountNativeExtrusionHandles} from './extrude-native-handles';
import type {FeatureEditor} from './shared';

const identity=(face:SolidFaceReference)=>JSON.stringify([face.sourceFeatureId,face.bodyId,face.normal,face.surfaceType,face.faceAnchor]);
export const offsetFaceEditor:FeatureEditor={
 type:'offset-face',
  handles: false,
 controls(context) {
  const rw=context.feature?.replaceWith;
  return {faces:context.field('Offset face references',JSON.stringify(context.feature?.faces??[])),replaceMode:context.field('Replace with plane',rw?'yes':'no',['no','yes']),replaceSource:context.field('Plane source',rw?.kind??'principal',['principal','feature','face']),replaceFace:context.field('Target face',JSON.stringify(rw?.kind==='face'?[rw]:[])),replacePlane:context.field('Replace plane',rw?.kind==='principal'?rw.plane:'XY',['XY','XZ','YZ']),replaceOffset:context.field('Replace plane offset (mm)',String(rw?.kind==='principal'?rw.offsetMillimeters:0)),replaceFeature:context.reference('Replace plane feature',['plane'],rw?.kind==='feature'?rw.featureId:undefined),...faceTransformControls(context)};
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
  const rowOf=(key:string)=>controls[key].closest<HTMLElement>('.aui-feature-row')??controls[key].parentElement;
  const targetFace=mountPickedReferences<SolidFaceReference>(context,controls.replaceFace,{title:'Target face (replace)',kind:'face',requestEvent:'aether-offset-faces-request',replyEvent:'aether-offset-faces',replyKey:'faces',identity:faceIdentity,note:'Optional: a parallel planar face the picked faces move onto.',onChange:picked=>{if(picked.length>1)targetFace.update([picked[picked.length-1]]);else if(picked.length){controls.replaceMode.value='yes';controls.replaceSource.value='face';controls.replaceMode.dispatchEvent(new Event('change'));}}});
  const syncReplace=()=>{const on=controls.replaceMode.value==='yes',src=controls.replaceSource.value;for(const [key,show] of [['replaceSource',on],['replacePlane',on&&src==='principal'],['replaceOffset',on&&src==='principal'],['replaceFeature',on&&src==='feature']] as const){const el=rowOf(key);if(el)el.hidden=!show;}};
  controls.replaceMode.addEventListener('change',syncReplace);controls.replaceSource.addEventListener('change',syncReplace);syncReplace();
  if(!feature&&selected.length&&selected.every(item=>item.kind==='face'))queueMicrotask(request);
 },
 validate(controls){
  if(!JSON.parse(controls.faces.value).length)return 'Select one or more faces to offset.';
  if(controls.replaceMode.value==='yes'){if(controls.replaceSource.value==='feature'&&!controls.replaceFeature.value)return 'Choose the plane feature to replace the faces with.';if(controls.replaceSource.value==='face'&&!JSON.parse(controls.replaceFace.value).length)return 'Pick the target face.';return null;}
  return validateFaceTransform(controls);
 },
 serialize(values,context){
  const faces=(JSON.parse(values.faces) as Array<Record<string,unknown>>).map(f=>{delete f.centerMillimeters;return f;});
  if(values.replaceMode==='yes')return {faces,replaceWith:values.replaceSource==='face'?{kind:'face',...(()=>{const f=JSON.parse(values.replaceFace)[0];delete f.centerMillimeters;return f;})()}:values.replaceSource==='feature'?{kind:'feature',featureId:values.replaceFeature}:{kind:'principal',plane:values.replacePlane,offsetMillimeters:Number(values.replaceOffset)}};
  return {faces,...serializeFaceTransform(values,context)};},
};
