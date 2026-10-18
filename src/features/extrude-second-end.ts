import {extrusionPointPicker,serializeExtrusionPoint} from './extrude-point-picker';
import {extrusionPartPicker} from './extrude-part-picker';
import {layoutExtrudeDraft,serializeExtrudeDraft} from './extrude-draft';
import {extrusionFacePicker} from './planar-face-picker';
import {rowIn,unitSuffix,type Controls,type FeatureEditorContext} from './shared';

export function secondEndControls({field,feature}:FeatureEditorContext):Controls {
 const end=feature?.secondEnd;
 return {
  secondEnabled:field('Use second end',String(Boolean(end||feature?.secondDistanceMillimeters)),['false','true']),
  secondEndType:field('Opposite end condition',end?.endType??'blind',['blind','through-all','up-to-next','up-to-face','up-to-part','up-to-vertex']),
  second:field('Opposite depth (mm)',String(end?.distanceMillimeters??feature?.secondDistanceMillimeters??10)),
  secondPoint:field('Opposite stopping point',end?.endPointReference?JSON.stringify(end.endPointReference):''),
  secondPart:field('Opposite stopping part identity',end?.endPartId??''),
  secondReference:field('Opposite stopping face',end?.endReference?JSON.stringify(end.endReference):''),
  secondOffset:field('Opposite end offset (mm)',String(end?.endOffsetMillimeters??0)),
 };
}
export function layoutSecondEnd(context:FeatureEditorContext,controls:Controls) {
 const {win,form,lengthUnitLabel}=context;
 for(const control of [controls.secondEnabled,controls.secondEndType]){
  control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
 }
 const section=win.subsection('Second end position',{kind:'checkbox',open:controls.secondEnabled.value==='true',onToggle:value=>{
  controls.secondEnabled.value=String(value);sync();controls.secondEnabled.dispatchEvent(new Event('change'));
 }});
 const modes={Blind:'blind','Up to next':'up-to-next','Up to face':'up-to-face','Up to part':'up-to-part','Up to vertex':'up-to-vertex','Through all':'through-all'} as const;
 const mode=win.picker(Object.keys(modes),{ariaLabel:'Opposite end type',onChange:value=>{
  controls.secondEndType.value=modes[value as keyof typeof modes];sync();controls.secondEndType.dispatchEvent(new Event('change'));
 }});
 mode.setValue(Object.keys(modes).find(key=>modes[key as keyof typeof modes]===controls.secondEndType.value)??'Blind');section.body.append(mode.element);
 for(const control of [controls.second,controls.secondOffset]){control.closest('label')?.remove();control.setAttribute('form',form.id);}
 const depth=rowIn('Opposite depth',controls.second,unitSuffix(lengthUnitLabel)),offset=rowIn('End offset',controls.secondOffset,unitSuffix(lengthUnitLabel));
 const pointPicker=extrusionPointPicker(context,controls.secondPoint,'Opposite stopping point');
 const partPicker=extrusionPartPicker(context,controls.secondPart,'Opposite stopping part');
 const picker=extrusionFacePicker(context,controls.secondReference,'Opposite end face');
 section.body.append(depth,picker.element,partPicker.element,pointPicker.element,offset,layoutExtrudeDraft(context,controls,true));
 const note=document.createElement('p');note.className='cad-form-note';note.textContent='The opposite end grows from the same starting plane in the reverse direction, with its own limit and draft.';section.body.append(note);
 function sync(){
  const enabled=controls.secondEnabled.value==='true'&&!controls.endType.value.startsWith('symmetric'),type=controls.secondEndType.value;
  section.element.hidden=controls.endType.value.startsWith('symmetric');
  depth.hidden=type!=='blind';offset.hidden=!['up-to-next','up-to-face','up-to-part','up-to-vertex'].includes(type);
  pointPicker.setEnabled(enabled&&type==='up-to-vertex');picker.setEnabled(enabled&&type==='up-to-face');partPicker.setEnabled(enabled&&type==='up-to-part');
 }
 controls.secondEnabled.addEventListener('change',sync);controls.secondEndType.addEventListener('change',sync);controls.endType.addEventListener('change',sync);sync();
 return {sync};
}
export function validateSecondEnd(controls:Controls):string|null {
 if(controls.secondEnabled.value!=='true'||controls.endType.value.startsWith('symmetric'))return null;
 const mode=controls.secondEndType.value;
 if(mode==='blind'&&(!controls.second.value.trim()||!Number.isFinite(Number(controls.second.value))||Number(controls.second.value)<=0))return 'Opposite depth must be positive.';
 if(mode==='through-all'&&!['cut','intersect'].includes(controls.operation.value))return 'Opposite Through all requires Remove or Intersect.';
 if(mode==='up-to-vertex'&&!controls.secondPoint.value)return 'Select the opposite stopping point.';
 if(mode==='up-to-part'&&!controls.secondPart.value)return 'Select the opposite stopping part.';
 if(mode==='up-to-face'&&!controls.secondReference.value)return 'Select the opposite stopping face.';
 if(['up-to-face','up-to-next','up-to-part','up-to-vertex'].includes(mode)&&(!controls.secondOffset.value.trim()||!Number.isFinite(Number(controls.secondOffset.value))))return 'Enter a finite opposite end offset.';
 return null;
}
export function serializeSecondEnd(values:Record<string,string>,context:FeatureEditorContext) {
 if(values.secondEnabled!=='true'||values.endType.startsWith('symmetric'))return {};
 return {secondEnd:{endType:values.secondEndType,distanceMillimeters:values.secondEndType==='blind'?Number(values.second):1,
  ...(values.secondEndType==='up-to-vertex'?{endPointReference:serializeExtrusionPoint(values.secondPoint,context)}:{}),
  ...(values.secondEndType==='up-to-part'?{endPartId:values.secondPart}:{}),
  ...(values.secondEndType==='up-to-face'?{endReference:JSON.parse(values.secondReference)}:{}),
  ...(['up-to-face','up-to-next','up-to-part','up-to-vertex'].includes(values.secondEndType)&&Number(values.secondOffset)!==0?{endOffsetMillimeters:Number(values.secondOffset)}:{}),
  ...serializeExtrudeDraft(values,true)}};
}
