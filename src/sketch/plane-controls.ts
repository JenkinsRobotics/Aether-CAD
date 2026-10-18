import type {openFeatureWindow} from '@aether/ui';

/** Shared feature-window presentation; the workspace owns draft placement. */
export function mountSketchPlaneControls(win:ReturnType<typeof openFeatureWindow>, change:()=>void) {
  const box=win.entitiesBox('Sketch plane');
  let busy=false;
  return {
    render(label?:string){
      box.render(label?[{label,onRemove:()=>{if(!busy)change();}}]:[]);
      const remove=box.element.querySelector('button');
      if(remove){remove.disabled=busy;remove.title='Change sketch plane';}
    },
    setBusy(value:boolean){busy=value;const remove=box.element.querySelector('button');if(remove)remove.disabled=busy;},
  };
}
