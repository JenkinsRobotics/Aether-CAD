import {extrusionStartPlanes} from '../modeling/extrude-start-reference';
import {planarFacePicker} from './planar-face-picker';
import {rowIn,unitSuffix,type Controls,type FeatureEditorContext} from './shared';

export function extrudeStartControls({field,feature}:FeatureEditorContext):Controls {
 const ref=feature?.startingReference;
 return {startEnabled:field('Starting offset enabled',String(!!ref||!!feature?.startingOffsetMillimeters),['false','true']),
  startMode:field('Starting offset type',ref?.kind==='face'?'face':ref?'plane':'offset',['offset','face','plane']),
  startFace:field('Starting face',ref?.kind==='face'?JSON.stringify(ref):''),
  startPlane:field('Starting reference plane',ref&&ref.kind!=='face'?JSON.stringify(ref):'')};
}
export function layoutExtrudeStart(context:FeatureEditorContext,c:Controls){
 const {win,form,lengthUnitLabel}=context;
 for(const key of ['startEnabled','startMode','startFace','startPlane']){
  const control=c[key];control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
 }
 const section=win.subsection('Starting offset',{kind:'checkbox',open:c.startEnabled.value==='true',onToggle:enabled=>{
  c.startEnabled.value=String(enabled);sync();c.startEnabled.dispatchEvent(new Event('change'));
 }});
 const labels={'Blind offset':'offset','Selected face':'face','Reference plane':'plane'} as const;
 const picker=win.picker(Object.keys(labels),{ariaLabel:'Start type',onChange:label=>{
  c.startMode.value=labels[label as keyof typeof labels];sync();c.startMode.dispatchEvent(new Event('change'));
 }});
 picker.setValue(Object.keys(labels).find(key=>labels[key as keyof typeof labels]===c.startMode.value)??'Blind offset');
 section.body.append(rowIn('Start type',picker.element));
 const facePicker=planarFacePicker(context,c.startFace,'Starting planar face');section.body.append(facePicker.element);
 const planes=extrusionStartPlanes(context.doc,context.feature?.id);
 const saved=c.startPlane.value?JSON.parse(c.startPlane.value):null;
 const selected=planes.find(ref=>saved&&ref.kind===saved.kind&&(ref.kind==='principal'?ref.plane===saved.plane:'sourceFeatureId' in ref&&ref.sourceFeatureId===saved.sourceFeatureId));
 if(selected)c.startPlane.value=JSON.stringify(selected);
 const select=document.createElement('select');select.className='aui-input';select.setAttribute('aria-label','Starting reference plane');
 const option=(label:string,value:string)=>{const el=document.createElement('option');el.textContent=label;el.value=value;return el;};
 select.append(option('Choose a plane',''));
 for(const ref of planes)select.append(option(ref.label,JSON.stringify(ref)));
 if(c.startPlane.value&&!planes.some(ref=>JSON.stringify(ref)===c.startPlane.value))select.append(option('Saved reference (unavailable)',c.startPlane.value));
 select.value=c.startPlane.value;
 select.onchange=()=>{c.startPlane.value=select.value;c.startPlane.dispatchEvent(new Event('change'));};
 const planeRow=rowIn('Reference plane',select);section.body.append(planeRow);
 c.offset.closest('label')?.remove();c.offset.setAttribute('form',form.id);
 section.body.append(rowIn('Offset',c.offset,unitSuffix(lengthUnitLabel)));
 c.offset.title='Additional signed distance along the extrusion direction. Negative offsets start before the selected reference.';
 const help=document.createElement('p');help.className='cad-form-note';help.textContent='Choose a face or datum parallel to the sketch. Depth starts there; the optional offset moves the start along the extrusion direction. Draft keeps the sketch as its neutral plane.';section.body.append(help);
 function sync(){const enabled=c.startEnabled.value==='true';facePicker.setEnabled(enabled&&c.startMode.value==='face');planeRow.hidden=c.startMode.value!=='plane';help.hidden=c.startMode.value==='offset';}
 c.startEnabled.addEventListener('change',sync);c.startMode.addEventListener('change',sync);sync();
}
export function validateExtrudeStart(c:Controls):string|null {
 if(c.startEnabled.value!=='true')return null;
 if(!c.offset.value.trim()||!Number.isFinite(Number(c.offset.value)))return 'Enter a finite starting offset.';
 if(c.startMode.value==='face'&&!c.startFace.value)return 'Select a starting planar face.';
 if(c.startMode.value==='plane'&&!c.startPlane.value)return 'Select a starting reference plane.';
 return null;
}
export function serializeExtrudeStart(values:Record<string,string>){
 if(values.startEnabled!=='true')return {};
 return {...(values.startMode==='face'?{startingReference:{...JSON.parse(values.startFace),kind:'face'}}:values.startMode==='plane'?{startingReference:JSON.parse(values.startPlane)}:{}),
  ...(Number(values.offset)!==0?{startingOffsetMillimeters:Number(values.offset)}:{})};
}
