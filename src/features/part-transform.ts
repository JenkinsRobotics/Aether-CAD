import {transformReferenceControls,layoutTransformReferences,transformReferenceKeys,validateTransformReferences,serializeTransformReference} from './part-transform-reference';
import {serializeExtrusionPoint} from './extrude-point-picker';
import {availableBodies,bodyIDsForFeature,type PartTransform} from '@aether/core/document';
import {cadSelection} from '../cad-selection-store';
import {referencePickerLifecycle} from './reference-picker-lifecycle';
import {mountTransformHandles} from './part-transform-handles';
import {layoutParameterRows,type FeatureEditor} from './shared';
const vector=(values:Record<string,string>,prefix:string):[number,number,number]=>[Number(values[prefix+'X']),Number(values[prefix+'Y']),Number(values[prefix+'Z'])];
export const transformEditor:FeatureEditor={
 type:'transform',
 controls(context){
  const {field,feature,doc,initialTransform}=context;
  const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
  const prior={...doc,features:doc.features.slice(0,end),rollbackIndex:undefined};
  const meshes=new Set(prior.features.flatMap(f=>f.type==='import-cad'&&f.meshMode==='reference'?bodyIDsForFeature(prior,f):[]));
  const choices=availableBodies(prior).filter(b=>!meshes.has(b.id));
  const selected=feature?.bodyIds??[...new Set(cadSelection.snapshot().items.map(item=>item.partId))].filter(id=>choices.some(b=>b.id===id));
  const defaults:Record<string,PartTransform>={translate:{kind:'translate',translationMillimeters:[0,0,0]},rotate:{kind:'rotate',axisOriginMillimeters:[0,0,0],axisDirection:[0,0,1],angleDegrees:0},scale:{kind:'scale',centerMillimeters:[0,0,0],scaleFactors:[1,1,1]},copy:{kind:'copy'}};
  const t:PartTransform=feature?.transform??defaults[initialTransform??'translate'];
  const mapping={...feature?.copyBodyIds};for(const b of choices)mapping[b.id]??=`${doc.documentId}:copy-${crypto.randomUUID()}`;
  const fields={mode:field('Transform type',t.kind,['translate','translate-reference','rotate','rotate-reference','scale','scale-reference','copy']),bodies:field('Transform part IDs',JSON.stringify(selected)),outputs:field('Copy output IDs',JSON.stringify(mapping)),copy:field('Copy parts',feature?.copyBodyIds?'yes':'no',['no','yes']),uniform:field('Uniform scale',(t.kind!=='scale'&&t.kind!=='scale-reference')||new Set(t.scaleFactors).size===1?'yes':'no',['yes','no']),angle:field('Angle (degrees)',String((t.kind==='rotate'||t.kind==='rotate-reference')?t.angleDegrees:0))};
  const all:Record<string,HTMLInputElement|HTMLSelectElement>={...fields,...transformReferenceControls(context)};
  const groups:[string,string,number[],string][]=[['move','Translation',t.kind==='translate'?t.translationMillimeters:[0,0,0],' (mm)'],['origin','Axis origin',t.kind==='rotate'?t.axisOriginMillimeters:[0,0,0],' (mm)'],['axis','Axis direction',t.kind==='rotate'?t.axisDirection:[0,0,1],''],['center','Scale center',t.kind==='scale'?t.centerMillimeters:[0,0,0],' (mm)'],['scale','Scale factor',(t.kind==='scale'||t.kind==='scale-reference')?t.scaleFactors:[1,1,1],'']];
  for(const[prefix,label,values,suffix]of groups)for(const[i,axis]of ['X','Y','Z'].entries())all[prefix+axis]=field(`${label} ${axis}${suffix}`,String(values[i]));
  return all;
 },
 layout(context,c){
  const{doc,feature,win,form}=context;
  for(const key of ['bodies','outputs']){c[key].closest('label')?.remove();c[key].hidden=true;c[key].setAttribute('form',form.id);form.append(c[key]);}
  const names:{[key:string]:string}={translate:'Translate XYZ','translate-reference':'Translate by line or points',rotate:'Rotate','rotate-reference':'Rotate about reference',scale:'Scale','scale-reference':'Scale about point',copy:'Copy in place'};
  for(const option of c.mode.children)option.textContent=names[(option as HTMLOptionElement).value];
  layoutParameterRows(context,control=>[c.referenceEdge,c.fromPoint,c.toPoint,c.centerPoint].includes(control));
  const row=(key:string)=>c[key].closest<HTMLElement>('.aui-feature-row')??c[key].parentElement;
  const renderMode=()=>{for(const key of Object.keys(c)){
    if(['bodies','outputs','target','mode',...transformReferenceKeys].includes(key))continue;
    const visible=key==='copy'?c.mode.value!=='copy':key==='uniform'||key.startsWith('center')||key.startsWith('scale')?['scale','scale-reference'].includes(c.mode.value)&&(!key.startsWith('center')||c.mode.value==='scale')&&(c.uniform.value!=='yes'||!['scaleY','scaleZ'].includes(key)):key.startsWith('move')?c.mode.value==='translate':key==='angle'?['rotate','rotate-reference'].includes(c.mode.value):c.mode.value==='rotate';
    const element=row(key);if(element)element.hidden=!visible;
   }};
  c.mode.addEventListener('change',renderMode);c.uniform.addEventListener('change',renderMode);renderMode();
  const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
  const prior={...doc,features:doc.features.slice(0,end),rollbackIndex:undefined};
  const meshes=new Set(prior.features.flatMap(f=>f.type==='import-cad'&&f.meshMode==='reference'?bodyIDsForFeature(prior,f):[]));
  const choices=availableBodies(prior).filter(b=>!meshes.has(b.id));
  const box=win.entitiesBox('Parts to transform');win.body.prepend(box.element);const list=document.createElement('div');box.element.append(list);
  const selected=():string[]=>JSON.parse(c.bodies.value);
  const set=(ids:string[])=>{c.bodies.value=JSON.stringify(ids);render();c.bodies.dispatchEvent(new Event('change'));};
  const render=()=>{list.replaceChildren();for(const body of [...choices,...selected().filter(id=>!choices.some(b=>b.id===id)).map(id=>({id,name:'Unavailable part'}))]){
    const label=document.createElement('label');label.className='aui-feature-entity';const input=document.createElement('input');input.type='checkbox';input.checked=selected().includes(body.id);input.setAttribute('aria-label',`Transform ${body.name}`);
    input.onchange=()=>set(input.checked?[...selected(),body.id]:selected().filter(id=>id!==body.id));label.append(input,document.createTextNode(body.name));list.append(label);
  }};
  let bodyPicking=false;
  const lifecycle=referencePickerLifecycle('body',()=>win.panel.isConnected,active=>{bodyPicking=active;window.dispatchEvent(new CustomEvent('aether-source-body-picking',{detail:active}));});
  box.element.addEventListener('pointerdown',()=>lifecycle.setActive(true));
  let items=cadSelection.snapshot().items;
  const unsubscribe=cadSelection.subscribe(()=>{const next=cadSelection.snapshot().items;if(next===items)return;items=next;if(!bodyPicking||!next.length)return;const ids=[...new Set(next.map(item=>item.partId))].filter(id=>choices.some(b=>b.id===id));if(ids.length)set([...new Set([...selected(),...ids])]);});
  const clear=document.createElement('button');clear.type='button';clear.className='aui-button';clear.textContent='Clear parts';clear.onclick=()=>{cadSelection.dispatch({type:'clear'});set([]);};box.element.append(clear);
  const note=document.createElement('p');note.className='cad-form-note';note.textContent='Select parts in the viewport or list. Coordinates use the document origin. Copies are separate parts and follow source edits. Reference modes follow earlier sketch lines, solid edges or selected point pairs. Rotation follows the right-hand rule from the first point toward the second.';win.body.append(note);
  const scaleNote=document.createElement('p');scaleNote.className='cad-form-note';scaleNote.textContent='Scaling differently on each axis is unavailable for some curved parts. Use Uniform scale or edit the source dimensions if the geometry check fails.';win.body.append(scaleNote);
  const showScaleNote=()=>{scaleNote.hidden=!['scale','scale-reference'].includes(c.mode.value)||c.uniform.value==='yes';};c.mode.addEventListener('change',showScaleNote);c.uniform.addEventListener('change',showScaleNote);showScaleNote();
  mountTransformHandles(win.panel,c,context.lengthUnitLabel,context.angleUnitLabel);
  const observer=new window.MutationObserver(()=>{if(win.panel.isConnected)return;observer.disconnect();unsubscribe();lifecycle.dispose();});observer.observe(document.body,{childList:true,subtree:true});lifecycle.setActive(true);layoutTransformReferences(context,c);render();
 },
 validate(c){
  if(!JSON.parse(c.bodies.value).length)return 'Select one or more solid parts.';
  const referenceError=validateTransformReferences(c);if(referenceError)return referenceError;
  const keys=c.mode.value==='rotate-reference'?['angle']:c.mode.value==='scale-reference'?['scaleX',...(c.uniform.value==='yes'?[]:['scaleY','scaleZ'])]:c.mode.value==='translate'?['moveX','moveY','moveZ']:c.mode.value==='rotate'?['originX','originY','originZ','axisX','axisY','axisZ','angle']:c.mode.value==='scale'?['centerX','centerY','centerZ','scaleX',...(c.uniform.value==='yes'?[]:['scaleY','scaleZ'])]:[];
  if(keys.some(key=>!c[key].value.trim()||!Number.isFinite(Number(c[key].value))))return 'Enter finite transform values.';
  if(c.mode.value==='rotate'&&Math.hypot(...['axisX','axisY','axisZ'].map(key=>Number(c[key].value)))<1e-12)return 'Rotation needs a nonzero axis direction.';
  if(['scale','scale-reference'].includes(c.mode.value)&&keys.filter(key=>key.startsWith('scale')).some(key=>Number(c[key].value)<=0))return 'Scale factors must be positive.';
  return null;
 },
 serialize(v,context){
  const bodyIds:string[]=JSON.parse(v.bodies);let transform:PartTransform;
  if(v.mode==='translate-reference')transform={kind:'translate-reference',reference:serializeTransformReference(v,context),...(v.useDistance==='yes'?{distanceMillimeters:Number(v.distance)}:{}),...(v.reverseReference==='yes'?{reversed:true}:{})};
  else if(v.mode==='rotate-reference')transform={kind:'rotate-reference',reference:serializeTransformReference(v,context),angleDegrees:Number(v.angle)};
  else if(v.mode==='scale-reference')transform={kind:'scale-reference',centerReference:serializeExtrusionPoint(v.centerPoint,context),scaleFactors:v.uniform==='yes'?[Number(v.scaleX),Number(v.scaleX),Number(v.scaleX)]:vector(v,'scale')};
  else if(v.mode==='translate')transform={kind:'translate',translationMillimeters:vector(v,'move')};
  else if(v.mode==='rotate'){const axis=vector(v,'axis'),length=Math.hypot(...axis);transform={kind:'rotate',axisOriginMillimeters:vector(v,'origin'),axisDirection:axis.map(n=>n/length) as [number,number,number],angleDegrees:Number(v.angle)};}
  else if(v.mode==='scale')transform={kind:'scale',centerMillimeters:vector(v,'center'),scaleFactors:v.uniform==='yes'?[Number(v.scaleX),Number(v.scaleX),Number(v.scaleX)]:vector(v,'scale')};
  else transform={kind:'copy'};
  const outputs=JSON.parse(v.outputs);
  return {bodyIds,transform,...(v.copy==='yes'||v.mode==='copy'?{copyBodyIds:Object.fromEntries(bodyIds.map(id=>[id,outputs[id]]))}:{})};
 },
};
