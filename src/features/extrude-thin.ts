import { rowIn, unitSuffix, type Controls, type FeatureEditorContext } from './shared';

export function thinControls({field,feature}:FeatureEditorContext) {
 const thin=feature?.thin;
 return {creationMode:field('Creation type',thin?'thin':'solid',['solid','thin']),
  thickness1:field('Thickness 1 (mm)',String(thin?.thickness1Millimeters??1)),
  thickness2:field('Thickness 2 (mm)',String(thin?.thickness2Millimeters??0)),
  midThickness:field('Thickness (mm)',String(thin?.midplaneThicknessMillimeters??2)),
  midplane:field('Mid plane',String(thin?.midplane??false),['false','true']),
  flipWall:field('Flip wall',String(thin?.flipped??false),['false','true'])};
}
export function layoutThin(context:FeatureEditorContext,controls:Controls) {
 const {win,form,lengthUnitLabel}=context;
 const group=document.createElement('div');win.body.append(group);
 const flag=(key:string,label:string)=>{
  const control=controls[key];control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
  const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',label);box.checked=control.value==='true';
  box.onchange=()=>{control.value=String(box.checked);control.dispatchEvent(new Event('change'));sync();};
  group.append(rowIn(label,box));return box;
 };
 flag('midplane','Mid plane');
 const rows=['midThickness','thickness1','thickness2'].map((key,index)=>{
  const control=controls[key];control.closest('label')?.remove();control.setAttribute('form',form.id);
  const row=rowIn(['Thickness','Thickness 1','Thickness 2'][index],control,unitSuffix(lengthUnitLabel));group.append(row);return row;
 });
 const flip=flag('flipWall','Flip wall');
 const hint=document.createElement('p');hint.className='cad-form-note';hint.textContent='Thickness 1 is outside a closed loop, or to the right of an open curve in its sketch plane. Flip wall swaps sides. Open ends are capped flat.';group.append(hint);
 function sync(){group.hidden=controls.creationMode.value!=='thin';const middle=controls.midplane.value==='true';rows[0].hidden=!middle;rows[1].hidden=rows[2].hidden=middle;(flip.closest('.aui-feature-row') as HTMLElement).hidden=middle;}
 controls.creationMode.addEventListener('change',sync);sync();
}
export function validateThin(controls:Controls) {
 if(controls.creationMode.value!=='thin')return null;
 const middle=controls.midplane.value==='true';
 const keys=middle?['midThickness']:['thickness1','thickness2'];
 if(keys.some(key=>!controls[key].value.trim()||!Number.isFinite(Number(controls[key].value))||Number(controls[key].value)<0))return 'Enter finite, nonnegative wall thicknesses.';
 if(keys.reduce((sum,key)=>sum+Number(controls[key].value),0)<=0)return 'The total wall thickness must be positive.';
 return null;
}
export function serializeThin(values:Record<string,string>) {
 return values.creationMode==='thin'?{thin:{thickness1Millimeters:Number(values.thickness1),thickness2Millimeters:Number(values.thickness2),midplane:values.midplane==='true',midplaneThicknessMillimeters:Number(values.midThickness),flipped:values.flipWall==='true'}}:{};
}
