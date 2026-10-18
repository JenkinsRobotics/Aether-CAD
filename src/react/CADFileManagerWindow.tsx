import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, ToolIcon, TextField, SelectField, type DocumentElementTab, type DocumentConnection } from '@aether/ui';
import { navigateDocument } from '../document-navigation';
import './CADFileManagerWindow.css';

/** The current tab projection is authoritative. Load the file library only after an explicit Open action. */
export function CADFileManagerWindow({connection,tabs,project,standaloneTabs,onClose}:{connection:DocumentConnection;tabs:DocumentElementTab[];project:{name:string;linkedIds:string[]}|null;standaloneTabs:DocumentElementTab[];onClose:()=>void}) {
  const frame=useRef<HTMLIFrameElement>(null);
  const [page,setPage]=useState<'files'|'document'>('document');
  const [query,setQuery]=useState('');
  const [type,setType]=useState('all');
  const [sorted,setSorted]=useState(false);
  const filterTabs=(items:DocumentElementTab[])=>{
    const result=items.filter(tab=>tab.label.toLowerCase().includes(query.toLowerCase()) && (type==='all'||tab.detail===type));
    return sorted ? result.sort((a,b)=>a.label.localeCompare(b.label)) : result;
  };
  const shown=filterTabs(tabs);
  const standalone=filterTabs(standaloneTabs);
  const list=(items:DocumentElementTab[], label:string)=><ul aria-label={label}>
    {items.map(tab=><li key={tab.id}><button className="cad-managed-tab" aria-current={tab.current?'page':undefined} onClick={()=>{if(!tab.current)tab.onSelect?.();onClose();}}>
      <span className="cad-managed-tab-icon">{tab.icon}</span><span><strong>{tab.label}</strong><small>{tab.detail}</small></span>{tab.current&&<span className="cad-managed-tab-current">Active</span>}
    </button></li>)}
  </ul>;
  const [error,setError]=useState('');
  const busy=useRef(false);
  useEffect(() => {
    if (page !== 'document' || !project) return;
    let live = true;
    void import('../feature-authoring').then(({mountProjectTabs}) => { if(live) mountProjectTabs(); }).catch(error => { if(live) setError(String(error)); });
    return () => { live = false; };
  }, [page, Boolean(project)]);
  useEffect(()=>{
    const open=(event:MessageEvent)=>{
      if(event.origin!==location.origin || event.source!==frame.current?.contentWindow || busy.current) return;
      if(event.data?.type==='aether-cad-close-library') {onClose();return;}
      if(event.data?.type!=='aether-cad-open-file' || typeof event.data.id!=='string' || !event.data.id) return;
      busy.current=true;setError('');
      void (async()=>{
        try {await connection.flush(); await navigateDocument(`/cad/index.html?document=${encodeURIComponent(event.data.id)}`);onClose();}
        catch(error){setError(error instanceof Error?error.message:String(error));}
        finally{busy.current=false;}
      })();
    };
    window.addEventListener('message',open);return()=>window.removeEventListener('message',open);
  },[connection,onClose]);
  return <Dialog open title={page==='document' ? (project ? "Project tabs" : "Open tabs") : "Open a file"} onClose={onClose}>
    <div className="cad-file-manager-window">
      <div className="cad-file-manager-window-tabs">
        {page==='files' ? <Button onClick={()=>setPage('document')}>Back to tabs</Button> : <>
          <TextField aria-label="Search tabs" placeholder="Search tabs" value={query} onChange={event=>setQuery(event.target.value)}/>
          <SelectField aria-label="Filter tab types" value={type} onChange={event=>setType(event.target.value)} options={[{value:"all",label:"All types"},{value:"Part Studio",label:"Part studios"},{value:"Assembly",label:"Assemblies"}]}/>
          <Button aria-pressed={sorted} onClick={()=>setSorted(!sorted)}>Sort A–Z</Button>
          <Button onClick={()=>setPage('files')}>Open…</Button>
        </>}
      </div>
      {error && <p role="alert">{error}</p>}
      {page==='files' ? <iframe ref={frame} title="CAD file library" src="/cad/?embedded=1"/> : <div className="cad-managed-tabs">
        {project ? <>
          <details className="cad-managed-design" open><summary><ToolIcon name="assembly"/><span><strong>{project.name}</strong><small>Hybrid Design</small></span></summary>
            <div className="cad-managed-design-children">
              <h3>Integrated contents</h3>
              {(['Part Studio','Assembly'] as const).map(kind=>{
                const items=shown.filter(tab=>tab.detail===kind&&!project.linkedIds.includes(tab.id));
                return items.length ? <section key={kind}><h4>{kind==='Assembly'?'Assemblies':'Part studios'}</h4>{list(items,`Integrated ${kind}`)}</section> : null;
              })}
              {!shown.some(tab=>!project.linkedIds.includes(tab.id))&&<p className="cad-managed-tabs-empty">No integrated contents match this view.</p>}
              {project.linkedIds.length>0&&<section><h3>Linked standalone files</h3>{list(shown.filter(tab=>project.linkedIds.includes(tab.id)),'Linked standalone files')}</section>}
            </div>
          </details>
          {standaloneTabs.length>0&&<section className="cad-managed-standalone"><h3>Open standalone files</h3>{list(standalone,'Open standalone files')}{!standalone.length&&<p>No open files match this view.</p>}</section>}
        </> : <><h3>Open standalone files</h3>{list(shown,'Currently open files')}{!shown.length&&<p className="cad-managed-tabs-empty">{tabs.length?'No tabs match your search.':'No documents are open.'}</p>}</>}
        {project && <details className="cad-managed-project-actions"><summary>Project actions</summary><div data-cad-project-commands="" className="cad-project-commands"/></details>}
      </div>}

    </div>
  </Dialog>;
}
