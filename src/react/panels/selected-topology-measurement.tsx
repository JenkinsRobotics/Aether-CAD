import {useEffect,useState,useSyncExternalStore} from 'react';
import {InspectorSection,PropertyGrid} from '@aether/ui';
import {selectedTopologyAngle,type SelectedTopologyMeasurement as Measurement} from '../../viewport/topology-measurement';
import {displayQuantity,unitChoice} from '@aether/core/units';
import {cadSelection} from '../../cad-selection-store';
import {documentUnits,subscribeDocumentUnits} from '../../document-preferences';
/** Only native analytic quantities are shown; absent fields stay unavailable. */
export function SelectedTopologyMeasurement(){
 const selection=useSyncExternalStore(cadSelection.subscribe,cadSelection.snapshot,cadSelection.snapshot);
 const units=useSyncExternalStore(subscribeDocumentUnits,documentUnits,documentUnits);
 const [measurements,setMeasurements]=useState<Measurement[]>([]);
 useEffect(()=>{
  const receive=(event:Event)=>setMeasurements((event as CustomEvent<{measurements?:Measurement[]}>).detail.measurements??[]);
  const request=()=>window.dispatchEvent(new Event('aether-plane-geometry-request'));
  window.addEventListener('aether-plane-geometry',receive);window.addEventListener('aether-part-updated',request);
  setMeasurements([]);request();
  return ()=>{window.removeEventListener('aether-plane-geometry',receive);window.removeEventListener('aether-part-updated',request);};
 },[selection.items]);
 const length=unitChoice(units,'length');
 const format=(mm:number)=>`${displayQuantity(mm/1000,units,'length')} ${length.unit}`;
 const area=(mm2:number)=>`${(mm2/(length.factor*1000)**2).toFixed(length.decimals)} ${length.unit}²`;
 const selected=measurements.filter(m=>selection.items.some(item=>item.id===m.id));
 const angle=selection.items.length===2?selectedTopologyAngle(selected):null;
 const sections=selected.map(m=>({id:m.id,label:m.label,properties:[
  ...(m.lengthMillimeters===undefined?[]:[{id:'length',label:'Edge length',readOnly:true,editor:<output>{format(m.lengthMillimeters)}</output>}]),
  ...(m.areaSquareMillimeters===undefined?[]:[{id:'area',label:'Face area',readOnly:true,editor:<output>{area(m.areaSquareMillimeters)}</output>}]),
  ...(m.radiusMillimeters===undefined?[]:[{id:'radius',label:'Radius',readOnly:true,editor:<output>{format(m.radiusMillimeters)}</output>},{id:'diameter',label:'Diameter',readOnly:true,editor:<output>{format(m.radiusMillimeters*2)}</output>}]),
 ]}));
 if(angle)sections.unshift({id:'angle',label:'Angular measurement',properties:[
  {id:'acute-angle',label:angle.label,readOnly:true,editor:<output>{displayQuantity(angle.radians,units,'angle')} {unitChoice(units,'angle').unit}</output>},
 ]});
 if(selection.items.length===2 && selected.length===2 && selected.every(m=>m.kind==='edge' && m.centerMillimeters)){
  const delta=selected[1].centerMillimeters!.map((value,i)=>value-selected[0].centerMillimeters![i]);
  sections.unshift({id:'circle-centers',label:'Circular edge centers',properties:[
   {id:'center-distance',label:'Center-to-center',readOnly:true,editor:<output>{format(Math.hypot(...delta))}</output>},
   ...delta.map((value,i)=>({id:`center-${i}`,label:`Δ${'XYZ'[i]}`,readOnly:true,editor:<output>{format(value)}</output>})),
  ]});
 }
 return <InspectorSection title="Selected edge and face measurements">
  <PropertyGrid ariaLabel="Selected topology measurements" sections={sections} emptyState="Select an edge or face with native measurement data. Select two circular edges for center spacing, or straight edges / planar faces for an angle."/>
  {angle && <p className="cad-form-note">Shows the acute angle (0–90°), independent of edge or face orientation.</p>}
 </InspectorSection>;
}
