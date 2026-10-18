import {availableBodies,bodyIDsForFeature} from '@aether/core/document';
import {cadSelection} from '../cad-selection-store';
import {rowIn,type Control,type FeatureEditorContext} from './shared';

/** A part reference resolves its current shape at the feature's history position. */
export function extrusionPartPicker(context:FeatureEditorContext,control:Control,title:string) {
 const {doc,feature,win,form}=context;
 const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
 const prior={...doc,features:doc.features.slice(0,end),rollbackIndex:undefined};
 const meshes=new Set(prior.features.flatMap(f=>f.type==='import-cad'&&f.meshMode==='reference'?bodyIDsForFeature(prior,f):[]));
 const choices=availableBodies(prior).filter(b=>!meshes.has(b.id));
 control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
 const select=document.createElement('select');select.setAttribute('aria-label',title);
 for(const item of [{id:'',name:'Choose a part'},...choices,...(control.value&&!choices.some(b=>b.id===control.value)?[{id:control.value,name:'Unavailable stopping part'}]:[])]){
  const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.append(option);
 }
 select.value=control.value;
 const set=(value:string)=>{control.value=value;select.value=value;control.dispatchEvent(new Event('change'));};
 select.onchange=()=>set(select.value);
 const row=rowIn(title,select);
 const button=document.createElement('button');button.type='button';button.className='aui-button';button.textContent='Use selected part';button.setAttribute('aria-label',title+' from selection');
 button.onclick=()=>{
  const ids=[...new Set(cadSelection.snapshot().items.map(item=>item.partId))];
  if(ids.length!==1||!choices.some(b=>b.id===ids[0])){win.setError('Select one earlier solid part, or choose it from the list.');return;}
  set(ids[0]);
 };
 const element=document.createElement('div');element.append(row,button);
 const note=document.createElement('p');note.className='cad-form-note';note.textContent='The entire extrusion must stop against this part. Curved boundaries are supported. Missing or changed parts require repair.';element.append(note);win.body.append(element);
 return {element,setEnabled:(enabled:boolean)=>{element.hidden=!enabled;}};
}
