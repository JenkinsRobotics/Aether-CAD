import {availableBodies} from '@aether/core/document';
import type {Controls,FeatureEditorContext} from './shared';

/** The primary target stays in the shared field; scope adds explicit parts. */
export function layoutExtrudeScope(context:FeatureEditorContext,controls:Controls){
 const {doc,feature,form,win}=context;
 const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
 const bodies=availableBodies({...doc,features:doc.features.slice(0,end),rollbackIndex:undefined});
 controls.scope.closest('label')?.remove();controls.scope.hidden=true;controls.scope.setAttribute('form',form.id);form.append(controls.scope);
 const mode=controls.scopeMode;mode.closest('label')?.remove();mode.hidden=true;mode.setAttribute('form',form.id);form.append(mode);
 const allRow=document.createElement('label');allRow.className='aui-feature-row';
 const all=document.createElement('input');all.type='checkbox';all.setAttribute('aria-label','Merge with all');
 allRow.append(document.createTextNode('Merge with all'),all);win.body.append(allRow);
 const automaticHelp=document.createElement('p');automaticHelp.className='cad-form-note';win.body.append(automaticHelp);
 all.onchange=()=>{mode.value=all.checked?'all':'selected';mode.dispatchEvent(new Event('change'));};
 const box=win.entitiesBox('Additional parts to modify');win.body.append(box.element);
 const list=document.createElement('div');box.element.append(list);
 const help=document.createElement('p');help.className='cad-form-note';help.textContent='The merged part keeps the target part’s name and appearance.';box.element.append(help);
 const selected=():string[]=>JSON.parse(controls.scope.value);
 const render=()=>{
  const merge=controls.operation.value==='add';
  const modifying=['add','cut','intersect'].includes(controls.operation.value),automatic=mode.value==='all';
  all.checked=automatic;allRow.hidden=!modifying;automaticHelp.hidden=!modifying||!automatic;
  automaticHelp.textContent=merge?'Merge every touching solid part. Separate groups stay separate; each group keeps its earliest part’s name and appearance.':'Modify every solid part the extrusion overlaps. Parts outside the extrusion stay unchanged.';
  box.element.hidden=!modifying||automatic;
  const caption=merge?'Additional parts to merge':'Additional parts to modify';
  box.element.setAttribute('aria-label',caption);
  box.element.querySelector('.aui-feature-entities-caption')!.textContent=caption;
  help.hidden=!merge;
  list.replaceChildren();
  const options=[...bodies,...selected().filter(id=>!bodies.some(b=>b.id===id)).map((id,index)=>({id,name:doc.bodyProperties?.[id]?.name??`Unavailable part ${index+1}`}))];
  for(const body of options.filter(b=>b.id!==controls.target.value)){
   const label=document.createElement('label');label.className='aui-feature-entity';
   const input=document.createElement('input');input.type='checkbox';input.checked=selected().includes(body.id);
   input.setAttribute('aria-label',`Also ${merge?'merge':'modify'} ${body.name}`);
   input.onchange=()=>{controls.scope.value=JSON.stringify(input.checked?[...selected(),body.id]:selected().filter(id=>id!==body.id));controls.scope.dispatchEvent(new Event('change'));};
   label.append(input,document.createTextNode(body.name));list.append(label);
  }
  if(!list.children.length)list.textContent='No additional parts available.';
 };
 controls.operation.addEventListener('change',render);
 mode.addEventListener('change',render);
 controls.target.addEventListener('change',()=>{controls.scope.value=JSON.stringify(selected().filter(id=>id!==controls.target.value));render();controls.scope.dispatchEvent(new Event('change'));});
 render();
}
