import {useEffect,useRef,useState} from 'react';
import {Button,Dialog,FieldRow,SelectField} from '@aether/ui';
import type {SketchPlane} from '@aether/core/document';
import {appendVector} from '../modeling/vector-insert';
import {insertPreparedPart} from '../modeling/cad-import-service';
export function CADVectorInsertDialog({format,onClose}:{format:'svg'|'dxf'|null;onClose:()=>void}){
 const [file,setFile]=useState<File|null>(null),[plane,setPlane]=useState<SketchPlane>('XY'),[scale,setScale]=useState('1'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>{setFile(null);setError('');},[format]);
 useEffect(()=>()=>request.current?.abort(),[]);
 const close=()=>{request.current?.abort();onClose();};
 const run=async()=>{if(!file||!format)return;const control=new AbortController();request.current=control;setBusy(true);setError('');try{await insertPreparedPart(async source=>appendVector(source,file.name,await file.text(),format,plane,Number(scale)),control.signal);onClose();}catch(e){if(!control.signal.aborted)setError((e as Error).message);}finally{setBusy(false);request.current=null;}};
 return <Dialog open={format!==null} title={`Insert ${format?.toUpperCase()??'vector'}`} onClose={close} actions={<><Button onClick={close}>Cancel</Button><Button primary onClick={run} disabled={busy||!file||!Number.isFinite(Number(scale))||Number(scale)<=0}>{busy?'Inserting…':'Insert'}</Button></>}>
 <p>Insert editable contours as a new sketch profile. Double-click the profile in the feature tree to edit it.</p>
 <label>File <input type="file" accept={`.${format}`} disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
 <FieldRow label="Plane" htmlFor="vector-plane"><SelectField id="vector-plane" value={plane} disabled={busy} onChange={e=>setPlane(e.target.value as SketchPlane)} options={['XY','XZ','YZ'].map(value=>({value,label:value}))}/></FieldRow>
 <label>Millimeters per source unit <input aria-label="Millimeters per source unit" type="number" min="0.000001" step="any" value={scale} disabled={busy} onChange={e=>setScale(e.target.value)}/></label>
 <p>Use 1 for millimeters or 25.4 for inches. SVG drawing units are interpreted using this scale.</p>
 {error&&<p role="alert">{error}</p>}
 </Dialog>;
}
