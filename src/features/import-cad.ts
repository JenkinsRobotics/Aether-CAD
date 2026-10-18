import type {FeatureEditor} from './shared';
export const importCADEditor:FeatureEditor={
  type:'import-cad',
  controls(context){
    const f=context.feature,source=context.field('Source',f.sourceName);source.setAttribute('readonly','');
    const format=context.field('Format',f.format.toUpperCase());format.setAttribute('readonly','');
    const meshMode=f.meshMode?context.field('Mesh handling',f.meshMode,['reference','solid']):undefined;
    if(meshMode){const options=meshMode.querySelectorAll('option');options[0].textContent='Mesh reference';options[1].textContent='Convert closed mesh to solid';}
    const meshUnits=f.meshUnits?context.field('Source units',f.meshUnits,['mm','cm','m','in','ft']):undefined;
    const operation=context.field('Operation','new');operation.hidden=true;operation.closest('label')?.remove();context.form.append(operation);
    return {source,format,operation,...(meshMode?{meshMode,meshUnits}: {})};
  },
  layout(context){const note=document.createElement('p');note.className='cad-form-note';note.textContent=context.feature.meshMode?'Reference meshes retain triangles. Solid conversion requires a closed, valid mesh with at most 10,000 triangles and preserves its faceted shape. Changing units scales the imported geometry.':'The original geometry is stored in this Part. Source feature history is not imported. Open surface-only files must be sewn into solids in the source application.';context.win.body.append(note);},
  serialize(values,context){const f=context.feature;return {operation:'new',bodyId:f.bodyId,sourceName:f.sourceName,dataBase64:f.dataBase64,format:f.format,...(f.meshMode?{meshMode:values.meshMode,meshUnits:values.meshUnits}:{})};},
};
