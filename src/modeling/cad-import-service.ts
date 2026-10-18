import {serializePartDocument,type PartDocument} from '@aether/core/document';
import type {ImportedModelData} from '../domain';
import {appendCAD,type CADImportOptions} from './cad-import';
import {cadPresentation} from '../cad-presentation-store';

type ImportService={current:()=>PartDocument|null; available:()=>boolean; evaluate:(doc:PartDocument)=>Promise<ImportedModelData>; commit:(doc:PartDocument,model:ImportedModelData,message?:string)=>void; commitPresentation?:(doc:PartDocument)=>void};
let service:ImportService|undefined;
let files:readonly File[]=[];
let importing=false;
const listeners=new Set<()=>void>();
export function configureCADImport(value:ImportService){service=value;}
export const importFilesSnapshot=()=>files;
export function subscribeImportFiles(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
export function queueCADImport(value:readonly File[]){if(importing)return;files=[...value];for(const notify of listeners)notify();cadPresentation.patch({startScreen:'workspace',startDialog:'import'});}
export function clearImportFiles(){files=[];for(const notify of listeners)notify();}
/** All files build together; cancellation, failure or intervening edits never commit. */
export async function importCADFiles(selected:readonly File[],options:CADImportOptions,signal?:AbortSignal){
  if(!service)throw Error('The CAD importer is not ready.');
  if(importing)throw Error('An import is already running.');
  importing=true;
  try {
  const backend=service;
  if(!backend.available())throw Error('Finish or cancel the active sketch or feature and open a Part before importing.');
  const source=backend.current(),signature=source?serializePartDocument(source):null;
  const candidate=await appendCAD(source,selected,options);
  signal?.throwIfAborted();
  const model=await backend.evaluate(candidate);
  signal?.throwIfAborted();
  const current=backend.current();
  if(!backend.available()||current!==source||(current?serializePartDocument(current):null)!==signature)throw Error('The Part changed while importing. Retry the import into the current Part.');
  backend.commit(candidate,model);
  } finally {importing=false;}
}

/** Shared atomic insertion boundary for authoring dialogs; evaluates before committing. */
export async function insertPreparedPart(build:(source:PartDocument|null)=>Promise<PartDocument>,signal?:AbortSignal,message?:string){
 if(!service)throw Error('The CAD importer is not ready.');
 if(importing)throw Error('An import is already running.');
 const backend=service;
 if(!backend.available())throw Error('Finish or cancel the current editor before inserting.');
 const source=backend.current(),signature=source?serializePartDocument(source):null;
 importing=true;
 try{
  const next=await build(source);signal?.throwIfAborted();
  const model=await backend.evaluate(next);signal?.throwIfAborted();
  const current=backend.current();
  if(!backend.available()||current!==source||(current?serializePartDocument(current):null)!==signature)throw Error('The Part changed while inserting. Try again.');
  backend.commit(next,model,message);
 }finally{importing=false;}
}

export const currentInsertionDocument=()=>service?.current()??null;

let selectedImageFace:()=>import('@aether/core/document').ImageCanvas['face']=()=>undefined;
export function configureImageFacePicker(picker:typeof selectedImageFace){selectedImageFace=picker;}
export const selectedInsertionFace=()=>selectedImageFace();

/** Images change presentation only; do not rebuild geometry or require a kernel. */
export function editPartPresentation(build:(source:PartDocument|null)=>PartDocument,expected?:PartDocument|null){
 if(!service?.commitPresentation)throw Error('The presentation editor is not ready.');
 if(importing||!service.available())throw Error('Finish the current operation before editing images.');
 const source=service.current();
 if(expected!==undefined&&source!==expected)throw Error('The Part changed while the image editor was open. Reopen the editor.');
 const next=build(source);
 if(JSON.stringify(next.features)!==JSON.stringify(source?.features??[]))throw Error('Presentation edits cannot change geometry.');
 service.commitPresentation(next);
}
