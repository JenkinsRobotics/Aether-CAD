import { useEffect, useState } from 'react';
import { Button, Dialog, FieldRow, TextField } from '@aether/ui';
import type { Metadata } from './CADDocumentSettings';
import { deleteTab, duplicateTab, editTabProperties, loadTabMetadata, prepareTabDeletion, tabMetadataItem, tabPartCode, type CADTabAction, type CADTabDeletion, type CADTabTarget } from '../document-tab-actions';

export interface CADTabActionResult { action:CADTabAction; target:CADTabTarget; name?:string; copy?:{id:string;itemId?:string}; }
/** Flush before reading and retain the inspected revision through confirmation. */
export function CADTabActionDialog({target,action,flush,onClose,onApplied}:{target:CADTabTarget;action:CADTabAction;flush:()=>Promise<void>;onClose:()=>void;onApplied:(result:CADTabActionResult)=>void}) {
  const [meta,setMeta]=useState<Metadata|null>(null),[deletion,setDeletion]=useState<CADTabDeletion|null>(null);
  const [name,setName]=useState(target.name),[description,setDescription]=useState(''),[category,setCategory]=useState('');
  const [code,setCode]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const codeView=action==='code'||action==='clipboard';
  useEffect(()=>{
    let live=true;
    void (async()=>{
      await flush();
      if(codeView){
        const value=await tabPartCode(target);if(!live)return;setCode(value);
        if(action==='clipboard') {
          try {if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(value);if(live)setMessage('Part document copied.');}
          catch {if(live)setMessage('Select the code below and copy it with your keyboard.');}
        }
        return;
      }
      const value=await loadTabMetadata(target);if(!live)return;
      setMeta(value);
      const item=target.kind==='part'||target.itemId?tabMetadataItem(target,value):null;
      setName(action==='duplicate'?`${item?.name??target.name.replace(/\.[^.]+$/,'')} copy`:item?.name??target.name.replace(/\.[^.]+$/,''));
      setDescription(item?.description??'');setCategory(item?.category??'');
      if(action==='delete'){const checked=await prepareTabDeletion(target,value);if(live)setDeletion(checked);}
    })().catch(e=>{if(live)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[target,action,flush]);
  const readonly=Boolean(meta&&!meta.writable)||Boolean(target.revision)||(Boolean(target.linked)&&action!=='delete');
  const submit=async()=>{
    if(!meta||loading||busy)return;
    setBusy(true);setError('');
    try {
      // Do not replace the inspected revision with a newer one after the user confirmed.
      await flush();
      if(action==='delete'){if(!deletion)throw Error('Wait for the document to load.');await deleteTab(target,meta,deletion);}
      else if(action==='duplicate'){const copy=await duplicateTab(target,meta,name.trim());onApplied({action,target,copy});return;}
      else await editTabProperties(target,meta,{name:name.trim(),description,category},action==='rename');
      onApplied({action,target,name:name.trim()});
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const copyCode=async()=>{
    try {if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(code);setMessage('Part document copied.');}
    catch {setMessage('Select the code below and copy it with your keyboard.');}
  };
  const titles:Partial<Record<CADTabAction,string>>={delete:`Delete ${target.name}?`,rename:`Rename ${target.name}`,properties:`Properties — ${target.name}`,duplicate:`Duplicate ${target.name}`,code:`Code — ${target.name}`,clipboard:`Copy ${target.name} to clipboard`};
  const canWrite=Boolean(meta)&&!loading&&!busy&&(action==='duplicate'?(!target.itemId||!readonly):!readonly)&&Boolean(name.trim())&&name.trim().length<=180;
  return <Dialog open title={titles[action]??target.name} onClose={()=>{if(!busy)onClose();}} actions={<>
    <Button disabled={busy} onClick={onClose}>{codeView?'Done':'Cancel'}</Button>
    {codeView?<Button disabled={!code||loading} onClick={()=>void copyCode()}>Copy code</Button>:
      <Button primary disabled={!canWrite||(action==='delete'&&!deletion)} onClick={()=>void submit()}>{action==='delete'?'Delete':action==='duplicate'?'Create duplicate':'Save'}</Button>}
  </>}>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {loading&&<p role="status">Loading {target.name}…</p>}
    {!loading&&codeView&&<><p>Aether Part JSON — the feature document, including geometry parameters and units.</p>
      <textarea aria-label="Part document code" readOnly value={code} spellCheck={false} onFocus={event=>{if(action==='clipboard')event.currentTarget.select();}} style={{width:'100%',minWidth:300,height:'min(50vh,420px)',fontFamily:'monospace',boxSizing:'border-box'}}/>
    </>}
    {!loading&&meta&&!codeView&&<>
      {action==='delete'?<p>{target.itemId?'The tab will be retained under Restore deleted workspaces. Dependent assemblies or connectors must be removed before deletion.':'This document will move to the recycle bin. It can be restored from Aether Drive.'}</p>:<>
        <FieldRow label="Name" htmlFor="tab-action-name"><TextField id="tab-action-name" value={name} maxLength={180} disabled={busy||(readonly&&action!=='duplicate')} onChange={event=>setName(event.target.value)}/></FieldRow>
        {action==='properties'&&<>
          <FieldRow label="Type"><span>{target.kind==='part'?'Part Studio':'Assembly'}</span></FieldRow>
          <FieldRow label="Saved revision"><span>{meta.revision}</span></FieldRow>
          <FieldRow label="Length units"><span>{meta.settings.units?.length?.unit??'mm'}</span></FieldRow>
          <FieldRow label="Description" htmlFor="tab-action-description"><TextField id="tab-action-description" value={description} maxLength={10000} disabled={readonly||busy} onChange={event=>setDescription(event.target.value)}/></FieldRow>
          <FieldRow label="Category" htmlFor="tab-action-category"><TextField id="tab-action-category" value={category} maxLength={120} disabled={readonly||busy} onChange={event=>setCategory(event.target.value)}/></FieldRow>
        </>}
        {action==='duplicate'&&<p>{target.itemId?'Creates an independent Part Studio in this document.':'Creates an independent copy in My files. The original history stays with its source.'}</p>}
      </>}
      {readonly&&action!=='duplicate'&&<p>This tab is read-only.</p>}
    </>}
  </Dialog>;
}
