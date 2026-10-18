import type { MenuItem } from '@aether/ui';
import { decodeDocument, documentRequest, fileRecycleRequest } from '@aether/session/documents';
import { parsePartDocument, serializePartDocument } from '@aether/core/document';
import type { Metadata } from './react/CADDocumentSettings';

/** Identity captured from the clicked tab, never inferred from the active editor later. */
export interface CADTabTarget {
  id: string;
  name: string;
  kind: 'part' | 'assembly';
  current: boolean;
  documentId: string | null;
  itemId?: string;
  branch?: string;
  revision?: number;
  linked?: boolean;
}
export type CADTabAction = 'delete'|'open-browser'|'rename'|'properties'|'code'|'duplicate'|'clipboard'|'thumbnail'|'move-document';
export function tabActionItems(target:CADTabTarget):MenuItem[] {
  const saved=target.documentId ? undefined : 'Save this document to the server first.';
  const readonly=target.revision ? 'Historical revisions are read-only.' : undefined;
  const linked=target.linked ? 'Edit this linked Part in its source document.' : undefined;
  const assemblyCode=target.kind==='assembly' ? 'Assemblies use a binary archive. Show code and clipboard currently support Part Studios.' : undefined;
  const item=(id:CADTabAction,label:string,disabledReason?:string,separatorBefore=false):MenuItem=>({id,label,disabled:Boolean(disabledReason),disabledReason,separatorBefore});
  return [
    {...item('delete','Delete',saved??readonly),danger:true},
    item('open-browser','Open in new browser tab',saved,true),
    item('rename','Rename',saved??readonly??linked),
    item('properties','Properties…',saved??(target.kind==='assembly'&&!target.itemId?'Use Document properties for an Assembly file.':undefined)),
    item('code','Show code',assemblyCode),
    item('duplicate','Duplicate',saved??(target.itemId ? readonly??(target.kind==='assembly'?'Assembly tab duplication is not supported yet.':undefined) : undefined),true),
    item('clipboard','Copy to clipboard',assemblyCode),
    item('thumbnail','Select as document thumbnail','Custom document thumbnails are not supported by the document library yet.',true),
    item('move-document','Move to document…','Moving tabs between documents needs dependency-preserving transfer support; it is not available yet.'),
  ];
}
export function tabURL(target:CADTabTarget):string {
  if(!target.documentId)throw Error('Save this document to the server first.');
  const query=new URLSearchParams({document:target.documentId});
  if(target.itemId)query.set(target.kind,target.itemId);
  if(target.branch)query.set('branch',target.branch);
  if(target.revision)query.set('revision',String(target.revision));
  return '/cad/index.html?'+query;
}
const scope=(target:CADTabTarget)=>({id:target.documentId,...(target.branch?{branch:target.branch}:{}),...(target.revision?{revision:target.revision}:{})});
async function read<T>(path:string,data:object):Promise<T>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw Error(result.error??'The document could not be read.');return result;
}
export async function loadTabMetadata(target:CADTabTarget):Promise<Metadata> {
  if(!target.documentId)throw Error('Save this document to the server first.');
  return read('/api/library/cad_metadata',{app:'cad',...scope(target)});
}
export function tabMetadataItem(target:CADTabTarget,meta:Metadata) {
  const item=meta.items.find(item=>item.id===(target.itemId??'part'));
  if(!item)throw Error('This tab no longer exists in the document. Reopen the document.');
  return item;
}
export async function tabPartCode(target:CADTabTarget):Promise<string> {
  if(target.kind!=='part')throw Error('Show code is available for Part Studios.');
  let text:string;
  if(!target.documentId) {
    const {currentEditorSnapshot}=await import('./host-library');
    const snapshot=target.current&&currentEditorSnapshot();
    if(!snapshot)throw Error('Wait for this Part to finish loading.');
    text=new TextDecoder().decode(snapshot.bytes);
  } else if(target.itemId) {
    const result=await documentRequest<{project:{parts:{id:string;document:unknown}[]}}>('cad','project_read',scope(target));
    const part=result.project.parts.find(part=>part.id===target.itemId);
    if(!part?.document)throw Error('This tab has no editable Part document.');
    text=JSON.stringify(part.document);
  } else {
    const result=await documentRequest<{data_base64:string}>('cad',target.revision?'read_revision':'read',scope(target));
    text=decodeDocument(result.data_base64);
  }
  // Show the actual portable feature document, not a fabricated modeling script.
  return serializePartDocument(parsePartDocument(text));
}
export async function editTabProperties(target:CADTabTarget,meta:Metadata,values:{name:string;description:string;category:string},renameOnly=false) {
  if(!meta.writable||target.revision||target.linked)throw Error('This tab is read-only.');
  if(renameOnly&&!target.itemId)return documentRequest<{id:string}>('cad','cad_operation',{...scope(target),expected_revision:meta.revision,operation:'rename',name:values.name});
  const item=tabMetadataItem(target,meta);
  return documentRequest<{id:string}>('cad','cad_operation',{
    ...scope(target),expected_revision:meta.revision,
    operation:renameOnly&&!target.itemId?'rename':'properties',
    item_id:item.id,...values,quantities:meta.settings.itemQuantities?.[item.id]??{},
  });
}
export async function duplicateTab(target:CADTabTarget,meta:Metadata,name:string) {
  if(target.itemId) {
    if(!meta.writable||target.revision)throw Error('This project is read-only.');
    const code=await tabPartCode({...target,revision:meta.revision});
    const result=await documentRequest<{id:string;project:{parts:{id:string}[]}}>('cad','project_edit',{
      id:target.documentId,expected_revision:meta.revision,...(target.branch?{branch:target.branch}:{}),
      operation:'add_part',name,document:JSON.parse(code),
    });
    return {id:result.id,itemId:result.project.parts.at(-1)!.id};
  }
  const result=await documentRequest<{id:string}>('cad','cad_operation',{
    ...scope(target),expected_revision:meta.revision,operation:'copy',name,parent:null,
  });
  return {id:result.id};
}
export interface CADTabDeletion { structureRevision?:number; }
export async function prepareTabDeletion(target:CADTabTarget,meta:Metadata):Promise<CADTabDeletion> {
  if(target.revision)throw Error('Historical revisions are read-only.');
  if(target.itemId){if(!meta.writable)throw Error('This project is read-only.');tabMetadataItem(target,meta);return {};}
  const file=await read<{id:string;manageable:boolean;structure_revision:number}>('/api/drive/details',{id:target.documentId});
  if(file.id!==target.documentId||!file.manageable)throw Error('Only the document owner can move it to the recycle bin.');
  if(!Number.isSafeInteger(file.structure_revision)||file.structure_revision<1)throw Error('Reopen the file to obtain its current revision.');
  return {structureRevision:file.structure_revision};
}
export async function deleteTab(target:CADTabTarget,meta:Metadata,deletion:CADTabDeletion) {
  if(target.itemId) {
    if(!meta.writable||target.revision)throw Error('This project is read-only.');
    return documentRequest('cad','cad_operation',{...scope(target),expected_revision:meta.revision,operation:'delete_item',item_id:target.itemId});
  }
  if(target.revision||!Number.isSafeInteger(deletion.structureRevision))throw Error('Reopen the deletion dialog before continuing.');
  return fileRecycleRequest('trash',{id:target.documentId,expected_structure_revision:deletion.structureRevision});
}
