import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Button,Dialog,FieldRow,SelectField} from '@aether/ui';
import {cadPresentation,type CADPresentationSnapshot} from '../cad-presentation-store';
import {importFormat,isMeshImportFormat} from '../modeling/cad-import';
import {clearImportFiles,importCADFiles,importFilesSnapshot,subscribeImportFiles} from '../modeling/cad-import-service';
import type {MeshImportUnits} from '@aether/core/document';

export function CADImportDialog({presentation}:{presentation:CADPresentationSnapshot}){
  const files=useSyncExternalStore(subscribeImportFiles,importFilesSnapshot,importFilesSnapshot);
  const [units,setUnits]=useState<MeshImportUnits>('mm'),[mode,setMode]=useState<'reference'|'solid'>('reference');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[stopping,setStopping]=useState(false);
  const request=useRef<AbortController|null>(null),open=presentation.startDialog==='import';
  useEffect(()=>{if(open){setError('');setStopping(false);}},[open,files]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const descriptions=files.map(file=>{try{return {file,format:importFormat(file.name),error:''};}catch(e){return {file,error:(e as Error).message};}});
  const hasMesh=descriptions.some(item=>item.format&&isMeshImportFormat(item.format));
  const problem=descriptions.find(item=>item.error)?.error;
  const close=()=>{cadPresentation.patch({startDialog:null});clearImportFiles();};
  const cancel=()=>{if(busy){request.current?.abort();setStopping(true);}else close();};
  const run=async()=>{
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');
    try{await importCADFiles(files,{meshUnits:units,meshMode:mode},controller.signal);close();}
    catch(e){if(controller.signal.aborted)close();else setError((e as Error).message);}
    finally{request.current=null;setBusy(false);setStopping(false);}
  };
  return <Dialog open={open} title="Import CAD" onClose={cancel} actions={<><Button disabled={stopping} onClick={cancel}>{stopping?'Cancelling…':'Cancel'}</Button><Button primary disabled={busy||!files.length||!!problem} onClick={run}>{busy?'Importing…':'Import'}</Button></>}>
    <p>STEP, IGES and BREP solids · STL, OBJ, PLY and OFF meshes</p>
    <Button disabled={busy} onClick={()=>document.querySelector<HTMLInputElement>('#step-picker')?.click()}>Choose files…</Button>
    {files.length>0?<ul aria-label="Files to import">{descriptions.map(({file,format},i)=><li key={i}>{file.name} · {format?.toUpperCase()??'Unsupported'} · {(file.size/1024).toFixed(1)} KiB</li>)}</ul>:<p>Choose files or drop them into the viewport. They will be added to the current Part.</p>}
    {hasMesh&&<>
      <FieldRow label="Mesh source units" htmlFor="import-mesh-units"><SelectField id="import-mesh-units" value={units} disabled={busy} onChange={e=>setUnits(e.target.value as MeshImportUnits)} options={[{value:'mm',label:'Millimeters (mm)'},{value:'cm',label:'Centimeters (cm)'},{value:'m',label:'Meters (m)'},{value:'in',label:'Inches (in)'},{value:'ft',label:'Feet (ft)'}]}/></FieldRow>
      <FieldRow label="Mesh handling" htmlFor="import-mesh-mode"><SelectField id="import-mesh-mode" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as 'reference'|'solid')} options={[{value:'reference',label:'Mesh reference'},{value:'solid',label:'Convert closed mesh to solid'}]}/></FieldRow>
      <p>{mode==='reference'?'Retains mesh triangles for display and STL export. Solid editing, exact measurements and STEP export require conversion.':'Requires a closed, valid mesh with at most 10,000 triangles. The solid stays faceted; original curves and feature history cannot be recovered.'}</p>
      <p>Mesh coordinates have no assumed CAD units. Choose the units used when the file was exported.</p>
    </>}
    <p>Original file data is saved in the Part. STEP/IGES units are read from the source; BREP uses millimeters. Solid-only import does not retain assembly mates or the source feature tree.</p>
    <p>Maximum 3 MiB per file and 4 MiB per saved Part. For SolidWorks, Inventor, CATIA or Parasolid files, export STEP first. Import 2D SVG/DXF through Sketch.</p>
    {(problem||error)&&<p role="alert">{problem||error}</p>}
    {busy&&<p role="status">{stopping?'Waiting for the current geometry operation to finish. Nothing will be added.':'Reading geometry and validating the complete Part…'}</p>}
  </Dialog>;
}
