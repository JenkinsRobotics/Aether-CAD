import {useEffect,useState,useSyncExternalStore} from 'react';
import {InspectorSection,PropertyGrid} from '@aether/ui';
import {displayQuantity,unitChoice} from '@aether/core/units';
import {cadSelection} from '../../cad-selection-store';
import {documentUnits,subscribeDocumentUnits} from '../../document-preferences';
type Point = {label:string;positionMillimeters:readonly [number,number,number]};
/** Read-only measurement of the existing exact-topology pick projection. */
export function SelectedPointMeasurement(){
 const selection=useSyncExternalStore(cadSelection.subscribe,cadSelection.snapshot,cadSelection.snapshot);
 const units=useSyncExternalStore(subscribeDocumentUnits,documentUnits,documentUnits);
 const [points,setPoints]=useState<readonly Point[]>([]);
 useEffect(()=>{
   const receive=(event:Event)=>setPoints((event as CustomEvent<{points:Point[]}>).detail.points);
   window.addEventListener('aether-plane-geometry',receive);
   setPoints([]);
   window.dispatchEvent(new Event('aether-plane-geometry-request'));
   return ()=>window.removeEventListener('aether-plane-geometry',receive);
 },[selection.items]);
 const single=points.length===1 && selection.items.length===1;
 const pair=points.length===2 && selection.items.length===2;
 const delta=pair?points[1].positionMillimeters.map((n,i)=>n-points[0].positionMillimeters[i]):[];
 const format=(mm:number)=>`${displayQuantity(mm/1000,units,'length')} ${unitChoice(units,'length').unit}`;
 return <InspectorSection title="Selected point measurement">
   <PropertyGrid ariaLabel="Selected point measurement" emptyState="Select a topology vertex for its position, or two vertices to measure spacing."
     sections={pair?[{id:'distance',label:`${points[0].label} → ${points[1].label}`,properties:[
       {id:'distance',label:'Point-to-point distance',readOnly:true,editor:<output>{format(Math.hypot(...delta))}</output>},
       ...delta.map((n,i)=>({id:`axis-${i}`,label:`Δ${'XYZ'[i]}`,readOnly:true,editor:<output>{format(n)}</output>})),
     ]}]:single?[{id:'position',label:points[0].label,properties:points[0].positionMillimeters.map((n,i)=>({id:`position-${i}`,label:`${'XYZ'[i]} position`,readOnly:true,editor:<output>{format(n)}</output>}))}]:[]}/>
   <p className="cad-form-note">For center-to-center spacing, select two circular edges; their exact centers appear below.</p>
 </InspectorSection>;
}
