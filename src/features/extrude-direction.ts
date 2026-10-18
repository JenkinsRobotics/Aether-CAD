import {sketchDirectionLines,directionLineVector} from '../modeling/extrude-direction-reference';
import {stampRegion} from './regions';
import {rowIn,type Controls,type FeatureEditorContext} from './shared';

const axes:Record<string,[number,number,number]>={X:[1,0,0],Y:[0,1,0],Z:[0,0,1]};
export function extrudeDirectionControls(context:FeatureEditorContext):Controls {
 const {field,feature}=context;
 const lines=sketchDirectionLines(context.doc,feature?.id);
 const key=(line:typeof lines[number])=>JSON.stringify([line.sourceFeatureId,line.contourIndex,line.segmentIndex]);
 const ref=feature?.directionReference;
 const selected=lines.find(line=>ref&&line.sourceFeatureId===ref.sourceFeatureId&&line.contourId===ref.contourId&&line.segmentId===ref.segmentId);
 const lineField=field('Direction sketch line',selected?key(selected):'',['',...lines.map(key)]);
 for(const option of (lineField as HTMLSelectElement).options)option.textContent=lines.find(line=>key(line)===option.value)?.label??'Choose a straight sketch line';
 const lineVector=field('Resolved direction vector','');
 const sync=()=>{const line=lines.find(line=>key(line)===lineField.value);lineVector.value=line?JSON.stringify(directionLineVector(line)):'';};
 lineField.addEventListener('change',sync);sync();
 const vector=feature?.directionVector as [number,number,number]|undefined;
 const mode=ref?'line':vector?Object.keys(axes).find(key=>axes[key].every((v,i)=>v===vector[i]))??'custom':'normal';
 return {directionLine:lineField,directionReferenceVector:lineVector,directionMode:field('Extrusion direction',mode,['normal','X','Y','Z','custom','line']),
  directionX:field('Direction X',String(vector?.[0]??0)),directionY:field('Direction Y',String(vector?.[1]??0)),directionZ:field('Direction Z',String(vector?.[2]??1))};
}
export function directionVector(values:Record<string,string>):[number,number,number]|undefined|null {
 if(values.directionMode==='normal'||values.directionMode===undefined)return undefined;
 if(axes[values.directionMode])return [...axes[values.directionMode]];
 if(values.directionMode==='line'){try{const vector=JSON.parse(values.directionReferenceVector);return Array.isArray(vector)&&vector.length===3&&vector.every(Number.isFinite)&&Math.abs(Math.hypot(...vector)-1)<1e-6?vector as [number,number,number]:null;}catch{return null;}}
 const raw=[values.directionX,values.directionY,values.directionZ];
 if(raw.some(v=>!v?.trim()))return null;
 const numbers=raw.map(Number),length=Math.hypot(...numbers);
 if(!numbers.every(Number.isFinite)||!Number.isFinite(length)||length<1e-12)return null;
 return numbers.map(v=>v/length) as [number,number,number];
}
export function layoutExtrudeDirection(context:FeatureEditorContext,controls:Controls,body:HTMLElement) {
 const {win,form}=context, mode=controls.directionMode;
 mode.closest('label')?.remove();mode.hidden=true;mode.setAttribute('form',form.id);form.append(mode);
 const labels={'Normal to sketch':'normal','World X axis':'X','World Y axis':'Y','World Z axis':'Z','Custom vector':'custom','Sketch line':'line'} as const;
 const picker=win.picker(Object.keys(labels),{ariaLabel:'Direction reference',onChange:label=>{
  mode.value=labels[label as keyof typeof labels];mode.dispatchEvent(new Event('change'));
 }});
 picker.setValue(Object.keys(labels).find(key=>labels[key as keyof typeof labels]===mode.value)??'Normal to sketch');
 body.append(rowIn('Direction reference',picker.element));
 const line=controls.directionLine;line.closest('label')?.remove();line.setAttribute('form',form.id);const lineRow=rowIn('Sketch line',line);body.append(lineRow);
 const vector=controls.directionReferenceVector;vector.closest('label')?.remove();vector.hidden=true;vector.setAttribute('form',form.id);form.append(vector);
 const rows=['X','Y','Z'].map(axis=>{const control=controls['direction'+axis];control.closest('label')?.remove();control.setAttribute('form',form.id);const row=rowIn(axis,control);body.append(row);return row;});
 const help=document.createElement('p');help.className='cad-form-note';help.textContent='Depth follows this world direction. Vector components are unitless and normalized. Choose a direction that leaves the sketch plane. Oblique draft is not supported yet.';body.append(help);
 const sync=()=>{lineRow.hidden=mode.value!=='line';rows.forEach(row=>row.hidden=mode.value!=='custom');help.hidden=mode.value==='normal';help.textContent=mode.value==='line'?'Follows the selected sketch line, including construction lines. Edit that line to update the direction; Flip direction reverses it. Solid edges and mate connectors are not available here yet.':'Depth follows this world direction. Vector components are unitless and normalized. Choose a direction that leaves the sketch plane. Oblique draft is not supported yet.';};mode.addEventListener('change',sync);sync();
}
export function validateExtrudeDirection(controls:Controls):string|null {
 if(controls.directionMode.value==='line'&&!controls.directionLine.value)return 'Choose an available straight line in an earlier sketch.';
 return directionVector(Object.fromEntries(Object.entries(controls).map(([key,control])=>[key,control.value])))===null?'Enter a finite, nonzero extrusion direction vector.':null;
}
export function serializeExtrudeDirection(values:Record<string,string>,context:FeatureEditorContext) {
 if(values.directionMode==='line'){
  const [sourceFeatureId,contourIndex,segmentIndex]=JSON.parse(values.directionLine);
  const contourId=stampRegion(context,sourceFeatureId,contourIndex);
  const line=sketchDirectionLines(context.doc,context.feature?.id).find(line=>line.sourceFeatureId===sourceFeatureId&&line.contourId===contourId&&line.segmentIndex===segmentIndex);
  if(!line?.segmentId)throw Error('Reselect the extrusion direction line.');
  return {directionReference:{kind:'sketch-line',sourceFeatureId,contourId,segmentId:line.segmentId}};
 }
 const vector=directionVector(values);return vector?{directionVector:vector}:{};
}
