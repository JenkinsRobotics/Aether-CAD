import {useEffect,useRef,useState} from 'react';
import {Button,Dialog,FieldRow,SelectField} from '@aether/ui';
import {appendSolidPrimitive,defaultPrimitiveDimensions,primitiveFields,primitiveNames,type SolidPrimitive,type PrimitiveDimensions} from '../modeling/solid-primitives';
import {insertPreparedPart} from '../modeling/cad-import-service';

const fieldLabels:Record<keyof PrimitiveDimensions,string>={width:'Width',length:'Length',height:'Height',radius:'Radius',tubeRadius:'Tube radius'};
export function CADPrimitiveDialog({kind,onClose}:{kind:SolidPrimitive|null;onClose:()=>void}) {
  const [dimensions,setDimensions]=useState(defaultPrimitiveDimensions),[scale,setScale]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>{setDimensions({...defaultPrimitiveDimensions});setScale(1);setError('');},[kind]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const close=()=>{request.current?.abort();onClose();};
  const run=async()=>{
    if(!kind)return;
    const control=new AbortController();request.current=control;setBusy(true);setError('');
    try {
      const mm=Object.fromEntries(Object.entries(dimensions).map(([key,value])=>[key,value*scale])) as PrimitiveDimensions;
      await insertPreparedPart(async source=>appendSolidPrimitive(source,kind,mm),control.signal,`Created ${primitiveNames[kind]}.`);
      onClose();
    }catch(error){if(!control.signal.aborted)setError((error as Error).message);}
    finally{setBusy(false);request.current=null;}
  };
  return <Dialog open={kind!==null} title={kind?primitiveNames[kind]:'Create solid'} onClose={close} actions={<>
    <Button onClick={close}>Cancel</Button><Button primary onClick={run} disabled={busy||!kind||primitiveFields[kind].some(key=>!Number.isFinite(dimensions[key])||dimensions[key]<=0)}>{busy?'Creating…':'Create'}</Button>
  </>}>
    <p>{kind==='sphere'||kind==='torus'?'Centered at the origin, around the Z axis.':'Centered on the XY plane, extending in positive Z.'} Creates a new body with an editable profile and solid feature.</p>
    <FieldRow label="Units" htmlFor="primitive-units"><SelectField id="primitive-units" value={String(scale)} disabled={busy} options={[{value:'1',label:'Millimeters'},{value:'25.4',label:'Inches'}]} onChange={e=>{
      const next=Number(e.target.value);setDimensions(previous=>Object.fromEntries(Object.entries(previous).map(([key,value])=>[key,value*scale/next])) as PrimitiveDimensions);setScale(next);
    }}/></FieldRow>
    {kind&&primitiveFields[kind].map(key=><FieldRow key={key} label={kind==='torus'&&key==='radius'?'Major radius':fieldLabels[key]} htmlFor={`primitive-${key}`}>
      <input id={`primitive-${key}`} type="number" min="0.000001" step="any" value={Number.isFinite(dimensions[key])?dimensions[key]:''} disabled={busy} onChange={e=>setDimensions(previous=>({...previous,[key]:e.target.value===''?NaN:Number(e.target.value)}))}/>
    </FieldRow>)}
    {error&&<p role="alert">{error}</p>}
  </Dialog>;
}
