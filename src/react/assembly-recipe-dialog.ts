import type { CADAssemblyController } from '../cad-assembly-controller';
import { exampleAssemblyRecipe, type AssemblyRecipePreset } from '../assembly-recipe';

/** A command dialog; the controller/native worker own validation and commits. */
export function openAssemblyRecipeDialog(controller:CADAssemblyController, kind:AssemblyRecipePreset='single') {
  if (document.querySelector('[data-assembly-recipe]')) return;
  const dialog=document.createElement('dialog'); dialog.className='feature-dialog'; dialog.dataset.assemblyRecipe='true';
  dialog.style.width='min(760px, 90vw)'; dialog.setAttribute('aria-label','Build Assembly from JSON');
  const title=document.createElement('h2'); title.textContent='Build Assembly from JSON'; dialog.append(title);
  const description=document.createElement('p');
  description.textContent='Reuse Part templates and place instances in millimeters. Linear and circular arrays create individual instances sharing the same Part. They do not create associative pattern features. Existing components are retained.';
  dialog.append(description);
  const form=document.createElement('form'); dialog.append(form);
  const label=document.createElement('label'); label.textContent='Part template';
  const templates=document.createElement('select'); templates.setAttribute('aria-label','Part template');
  templates.add(new Option('New 10 mm block',''));
  for(const part of controller.geometryProjection?.part_definitions??[]) if(part.feature_document)
    templates.add(new Option(part.name,part.id));
  label.append(templates);form.append(label);
  const presets=document.createElement('div');form.append(presets);
  const recipeLabel=document.createElement('label');recipeLabel.textContent='Assembly recipe';
  const editor=document.createElement('textarea');editor.setAttribute('aria-label','Assembly recipe');editor.spellcheck=false;
  editor.rows=16;editor.style.width='100%';editor.style.fontFamily='monospace';recipeLabel.append(editor);form.append(recipeLabel);
  function load(value:typeof kind){kind=value;if(kind==='template')templates.value='';templates.disabled=kind==='template';editor.value=JSON.stringify(exampleAssemblyRecipe(value,templates.value||undefined),null,2);}
  for(const [value,text] of [['template','Part template'],['single','Single instance'],['linear','Linear array'],['circular','Circular array']] as const){
    const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>load(value);presets.append(button);
  }
  templates.onchange=()=>load(kind);load(kind);
  const status=document.createElement('p');status.setAttribute('role','status');form.append(status);
  const submit=document.createElement('button');submit.type='submit';submit.textContent='Build and insert';form.append(submit);
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';form.append(cancel);
  const abort=new AbortController();const close=()=>{abort.abort();dialog.remove();};
  cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  form.onsubmit=async event=>{
    event.preventDefault();if(submit.disabled)return;
    try {
      const value=JSON.parse(editor.value);submit.disabled=true;editor.disabled=true;templates.disabled=true;
      for(const button of presets.querySelectorAll('button'))button.disabled=true;
      status.textContent='Rebuilding exact Parts and solving the Assembly…';
      await controller.composeRecipe(value,abort.signal);dialog.remove();
    } catch(error) {if(!abort.signal.aborted)status.textContent=error instanceof Error?error.message:String(error);}
    finally {submit.disabled=false;editor.disabled=false;templates.disabled=kind==='template';for(const button of presets.querySelectorAll('button'))button.disabled=false;}
  };
  document.body.append(dialog);dialog.showModal();
}
