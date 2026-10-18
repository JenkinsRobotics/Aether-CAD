import {cadSelection,type CADSelectionFilter} from '../cad-selection-store';
type Picker={activate:()=>void;deactivate:()=>void;available:()=>boolean};
let active:Picker|undefined;
const pickers=new Set<Picker>();
export const activateAvailableReferencePicker=()=>{if(!active)[...pickers].find(p=>p.available())?.activate();};
/** One face or point picker owns the temporary selection filter at a time. */
export function referencePickerLifecycle(filter:CADSelectionFilter,available:()=>boolean,onActive:(active:boolean)=>void) {
  let previous=cadSelection.snapshot().filter;
  const picker:Picker={available,activate:()=>{
    if(active===picker)return;
    active?.deactivate();previous=cadSelection.snapshot().filter;active=picker;
    cadSelection.dispatch({type:'set-filter',filter});onActive(true);
  },deactivate:()=>{
    if(active!==picker)return;
    active=undefined;cadSelection.dispatch({type:'set-filter',filter:previous});onActive(false);
  }};
  pickers.add(picker);
  return {setActive:(value:boolean)=>value?picker.activate():picker.deactivate(),
    dispose:()=>{pickers.delete(picker);picker.deactivate();activateAvailableReferencePicker();}};
}
