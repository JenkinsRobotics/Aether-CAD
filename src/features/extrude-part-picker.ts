import {availableBodies,bodyIDsForFeature} from '@aether/core/document';
import {mountPartBox} from './part-box';
import type {Control,FeatureEditorContext} from './shared';

/** The stopping part of an Up-to-part extent: a pick box filled by selecting a part in the viewport or tree. */
export function extrusionPartPicker(context:FeatureEditorContext,control:Control,title:string) {
 const {doc,feature,win}=context;
 const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
 const prior={...doc,features:doc.features.slice(0,end),rollbackIndex:undefined};
 const meshes=new Set(prior.features.flatMap(f=>f.type==='import-cad'&&f.meshMode==='reference'?bodyIDsForFeature(prior,f):[]));
 const box=mountPartBox(context,control,title,availableBodies(prior).filter(b=>!meshes.has(b.id)),()=>'',{single:true,scalar:true});
 const note=document.createElement('p');note.textContent='The entire extrusion must stop against this part. Curved boundaries are supported. Missing or changed parts require repair.';win.addHelp(note);
 return {element:box.element,setEnabled:(enabled:boolean)=>{box.element.hidden=!enabled;note.hidden=!enabled;}};
}
