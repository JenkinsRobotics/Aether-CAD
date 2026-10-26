import type {SolidFaceReference} from '@aether/core/document';
import {faceIdentity,mountPickedReferences} from './picked-references';
import {transformReferenceControls,layoutTransformReferences,transformReferenceKeys,validateTransformReferences,serializeTransformReference} from './part-transform-reference';
import {extrusionPointPicker,serializeExtrusionPoint} from './extrude-point-picker';
import {availableBodies,bodyIDsForFeature,type PartTransform} from '@aether/core/document';
import {cadSelection} from '../cad-selection-store';
import {referencePickerLifecycle} from './reference-picker-lifecycle';
import {mountTransformHandles} from './part-transform-handles';
import {layoutParameterRows,type FeatureEditor} from './shared';
const vector=(values:Record<string,string>,prefix:string):[number,number,number]=>[Number(values[prefix+'X']),Number(values[prefix+'Y']),Number(values[prefix+'Z'])];
export const transformEditor:FeatureEditor={
 type:'transform',
  handles: false,
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
  const mp=t.kind==='mirror'?t.plane:undefined;
  const al=t.kind==='align'?t:undefined;
  const fields={mode:field('Transform type',t.kind,['translate','translate-reference','rotate','rotate-reference','scale','scale-reference','copy','mirror','align']),alignFromKind:field('Align from',al?.from.kind??'face',['face','point']),alignToKind:field('Align to',al?.to.kind??'face',['face','point']),alignFromFace:field('From face',JSON.stringify(al?.from.kind==='face'?[al.from]:[])),alignToFace:field('To face',JSON.stringify(al?.to.kind==='face'?[al.to]:[])),alignFromPoint:field('From point',al?.from.kind==='point'?JSON.stringify(al.from.point):''),alignToPoint:field('To point',al?.to.kind==='point'?JSON.stringify(al.to.point):''),alignFlip:field('Faces the same way',al?.flip?'yes':'no',['no','yes']),mirrorSource:field('Mirror plane source',mp?.kind??'principal',['principal','feature','face']),mirrorPlane:field('Mirror plane',mp?.kind==='principal'?mp.plane:'YZ',['XY','XZ','YZ']),mirrorOffset:field('Mirror plane offset (mm)',String(mp?.kind==='principal'?mp.offsetMillimeters:0)),mirrorFeature:context.reference('Mirror plane feature',['plane'],mp?.kind==='feature'?mp.featureId:undefined),mirrorFace:field('Mirror face',JSON.stringify(mp?.kind==='face'?[mp]:[])),mirrorCombine:field('Join with the original',t.kind==='mirror'&&t.combine?'yes':'no',['no','yes']),bodies:field('Transform part IDs',JSON.stringify(selected)),outputs:field('Copy output IDs',JSON.stringify(mapping)),copy:field('Copy parts',feature?.copyBodyIds?'yes':'no',['no','yes']),uniform:field('Uniform scale',(t.kind!=='scale'&&t.kind!=='scale-reference')||new Set(t.scaleFactors).size===1?'yes':'no',['yes','no']),angle:field('Angle (degrees)',String((t.kind==='rotate'||t.kind==='rotate-reference')?t.angleDegrees:0))};
  const all:Record<string,HTMLInputElement|HTMLSelectElement>={...fields,...transformReferenceControls(context)};
  const groups:[string,string,number[],string][]=[['move','Translation',t.kind==='translate'?t.translationMillimeters:[0,0,0],' (mm)'],['origin','Axis origin',t.kind==='rotate'?t.axisOriginMillimeters:[0,0,0],' (mm)'],['axis','Axis direction',t.kind==='rotate'?t.axisDirection:[0,0,1],''],['center','Scale center',t.kind==='scale'?t.centerMillimeters:[0,0,0],' (mm)'],['scale','Scale factor',(t.kind==='scale'||t.kind==='scale-reference')?t.scaleFactors:[1,1,1],'']];
  for(const[prefix,label,values,suffix]of groups)for(const[i,axis]of ['X','Y','Z'].entries())all[prefix+axis]=field(`${label} ${axis}${suffix}`,String(values[i]));
  return all;
 },
 layout(context,c){
  const{doc,feature,win,form}=context;
  for(const key of ['bodies','outputs']){c[key].closest('label')?.remove();c[key].hidden=true;c[key].setAttribute('form',form.id);form.append(c[key]);}
  const names:{[key:string]:string}={align:'Align: bring a face or point onto another',mirror:'Mirror about plane or face',translate:'Translate XYZ','translate-reference':'Translate by line or points',rotate:'Rotate','rotate-reference':'Rotate about reference',scale:'Scale','scale-reference':'Scale about point',copy:'Copy in place'};
  for(const option of c.mode.children)option.textContent=names[(option as HTMLOptionElement).value];
  layoutParameterRows(context,control=>[c.referenceEdge,c.fromPoint,c.toPoint,c.centerPoint].includes(control));
  const row=(key:string)=>c[key].closest<HTMLElement>('.aui-feature-row')??c[key].parentElement;
  const renderMode=()=>{for(const key of Object.keys(c)){
    if(['bodies','outputs','target','mode','mirrorFace','alignFromFace','alignToFace','alignFromPoint','alignToPoint',...transformReferenceKeys].includes(key))continue;
    const visible=key.startsWith('align')?c.mode.value==='align':key.startsWith('mirror')?c.mode.value==='mirror'&&(key==='mirrorSource'||key==='mirrorCombine'||(key==='mirrorFeature'?c.mirrorSource.value==='feature':c.mirrorSource.value==='principal')):key==='copy'?c.mode.value!=='copy':key==='uniform'||key.startsWith('center')||key.startsWith('scale')?['scale','scale-reference'].includes(c.mode.value)&&(!key.startsWith('center')||c.mode.value==='scale')&&(c.uniform.value!=='yes'||!['scaleY','scaleZ'].includes(key)):key.startsWith('move')?c.mode.value==='translate':key==='angle'?['rotate','rotate-reference'].includes(c.mode.value):c.mode.value==='rotate';
    const element=row(key);if(element)element.hidden=!visible;
   }};
  c.mode.addEventListener('change',renderMode);c.uniform.addEventListener('change',renderMode);c.mirrorSource.addEventListener('change',renderMode);renderMode();
  const alignFromFace=mountPickedReferences<SolidFaceReference>(context,c.alignFromFace,{title:'Align from face',kind:'face',requestEvent:'aether-offset-faces-request',replyEvent:'aether-offset-faces',replyKey:'faces',identity:faceIdentity,onChange:picked=>{if(picked.length>1)alignFromFace.update([picked[picked.length-1]]);else if(picked.length){c.mode.value='align';c.alignFromKind.value='face';c.mode.dispatchEvent(new Event('change'));}}});
  const alignToFace=mountPickedReferences<SolidFaceReference>(context,c.alignToFace,{title:'Align to face',kind:'face',requestEvent:'aether-offset-faces-request',replyEvent:'aether-offset-faces',replyKey:'faces',identity:faceIdentity,onChange:picked=>{if(picked.length>1)alignToFace.update([picked[picked.length-1]]);else if(picked.length){c.alignToKind.value='face';}}});
  const alignFromPoint=extrusionPointPicker(context,c.alignFromPoint,'Align from point','The point brought onto the target.');const alignToPoint=extrusionPointPicker(context,c.alignToPoint,'Align to point','Where the from point lands.');
  const syncAlign=()=>{const on=c.mode.value==='align';alignFromPoint.setEnabled(on&&c.alignFromKind.value==='point');alignToPoint.setEnabled(on&&c.alignToKind.value==='point');};
  c.mode.addEventListener('change',syncAlign);c.alignFromKind.addEventListener('change',syncAlign);c.alignToKind.addEventListener('change',syncAlign);syncAlign();
  const mirrorFaces=mountPickedReferences<SolidFaceReference>(context,c.mirrorFace,{title:'Mirror face',kind:'face',requestEvent:'aether-offset-faces-request',replyEvent:'aether-offset-faces',replyKey:'faces',identity:faceIdentity,note:'Optional: a planar face to mirror about.',onChange:faces=>{if(faces.length>1)mirrorFaces.update([faces[faces.length-1]]);else if(faces.length){c.mode.value='mirror';c.mirrorSource.value='face';c.mode.dispatchEvent(new Event('change'));}}});
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
  const note=document.createElement('p');note.textContent='Select parts in the viewport or list. Coordinates use the document origin. Copies are separate parts and follow source edits. Reference modes follow earlier sketch lines, solid edges or selected point pairs. Rotation follows the right-hand rule from the first point toward the second.';win.addHelp(note);
  const scaleNote=document.createElement('p');scaleNote.textContent='Scaling differently on each axis is unavailable for some curved parts. Use Uniform scale or edit the source dimensions if the geometry check fails.';win.addHelp(scaleNote);
  const showScaleNote=()=>{scaleNote.hidden=!['scale','scale-reference'].includes(c.mode.value)||c.uniform.value==='yes';};c.mode.addEventListener('change',showScaleNote);c.uniform.addEventListener('change',showScaleNote);showScaleNote();
  mountTransformHandles(win.panel,c,context.lengthUnitLabel,context.angleUnitLabel);
  const observer=new window.MutationObserver(()=>{if(win.panel.isConnected)return;observer.disconnect();unsubscribe();lifecycle.dispose();});observer.observe(document.body,{childList:true,subtree:true});lifecycle.setActive(true);layoutTransformReferences(context,c);render();
 },
 validate(c){
  if(!JSON.parse(c.bodies.value).length)return 'Select one or more solid parts.';
  if(c.mode.value==='align'){if(c.alignFromKind.value==='face'?!JSON.parse(c.alignFromFace.value).length:!c.alignFromPoint.value)return 'Pick the from face or point.';if(c.alignToKind.value==='face'?!JSON.parse(c.alignToFace.value).length:!c.alignToPoint.value)return 'Pick the to face or point.';}
  if(c.mode.value==='mirror'){if(c.mirrorSource.value==='feature'&&!c.mirrorFeature.value)return 'Choose the plane feature to mirror about.';if(c.mirrorSource.value==='face'&&!JSON.parse(c.mirrorFace.value).length)return 'Pick the planar face to mirror about.';}
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
  else if(v.mode==='align'){const face=(s:string)=>{const f=JSON.parse(s)[0];delete f.centerMillimeters;return {kind:'face' as const,...f};};transform={kind:'align',from:v.alignFromKind==='face'?face(v.alignFromFace):{kind:'point',point:serializeExtrusionPoint(v.alignFromPoint,context)},to:v.alignToKind==='face'?face(v.alignToFace):{kind:'point',point:serializeExtrusionPoint(v.alignToPoint,context)},...(v.alignFlip==='yes'?{flip:true}:{})};}
  else if(v.mode==='mirror')transform={kind:'mirror',...(v.mirrorCombine==='yes'?{combine:true}:{}),plane:v.mirrorSource==='feature'?{kind:'feature',featureId:v.mirrorFeature}:v.mirrorSource==='face'?{kind:'face',...JSON.parse(v.mirrorFace)[0]}:{kind:'principal',plane:v.mirrorPlane as 'XY'|'XZ'|'YZ',offsetMillimeters:Number(v.mirrorOffset)}};
  else transform={kind:'copy'};
  const outputs=JSON.parse(v.outputs);
  const combined=v.mode==='mirror'&&v.mirrorCombine==='yes';
  return {bodyIds,transform,...(!combined&&(v.copy==='yes'||v.mode==='copy')?{copyBodyIds:Object.fromEntries(bodyIds.map(id=>[id,outputs[id]]))}:{})};
 },
};
