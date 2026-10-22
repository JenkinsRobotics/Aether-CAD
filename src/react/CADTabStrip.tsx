import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AetherIcon, DocumentTabBar, DocumentTabs, Menu, MenuButton, type MenuItem, type DocumentElementTab } from '@aether/ui';
import './CADTabStrip.css';
import {assignTabFolder, type TabFolder} from '../cad-tab-session';

/** CAD lifecycle gestures around the same DocumentTabBar used by Model Studio. */
export function CADTabStrip({tabs, placement, label, saveStatus, onAdd, onReorder, onDetach, onManage, folders=[],onFoldersChange,onOrganize,tabActions,onTabAction,leading,revisionForTab}: {
  leading?:ReactNode; revisionForTab?:(id:string)=>{label:string;title:string};
  tabActions?:(id:string)=>readonly MenuItem[]; onTabAction?:(id:string,action:string)=>void;
  saveStatus?:string;
  folders?:TabFolder[]; onFoldersChange?:(folders:TabFolder[])=>void; onOrganize?:()=>void;
  tabs: DocumentElementTab[]; placement: 'bottom'|'header'; label:string;
  onManage?:()=>void; onAdd:()=>void; onReorder:(source:string,target:string)=>void; onDetach:(id:string)=>void;
}) {
  const gesture = useRef<{id:string;x:number;y:number;dragging:boolean}|null>(null);
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{label:string;x:number;y:number}|null>(null);
  const current = tabs.find(tab=>tab.current);
  const saveTone = !saveStatus ? undefined : ['Saved', 'Downloaded'].includes(saveStatus)
    ? 'saved' : ['Saving…', 'Saved in this tab'].includes(saveStatus) ? 'pending' : 'error';
  const tabAt = (element: Element|null) => element?.closest<HTMLElement>('[data-document-tab-id]')?.dataset.documentTabId;
  const [context,setContext]=useState<{id:string;x:number;y:number}|null>(null);
  useEffect(()=>{if(context&&!tabs.some(tab=>tab.id===context.id))setContext(null);},[tabs,context]);
  const itemsFor=(id:string):MenuItem[]=>{
    const tab=tabs.find(item=>item.id===id);if(!tab)return [];
    const index=tabs.indexOf(tab);
    return [...(tabActions?.(id)??[]),
      {id:'arrange',label:'Arrange tab',separatorBefore:Boolean(tabActions),children:[
        {id:'left',label:'Move left',disabled:index===0},
        {id:'right',label:'Move right',disabled:index===tabs.length-1},
        {id:'detach',label:'Open in separate window',disabled:id==='draft'},
        ...(onOrganize?[{id:'organize',label:'Organize tabs…'}]:[]),
      ]},
      ...(tab.onClose?[{id:'close',label:'Close tab',separatorBefore:true}]:[]),
    ];
  };
  const choose=(id:string,action:string)=>{
    const tab=tabs.find(item=>item.id===id);if(!tab)return;
    const index=tabs.indexOf(tab);
    if(action==='left'&&index>0)onReorder(id,tabs[index-1].id);
    else if(action==='right'&&index<tabs.length-1)onReorder(id,tabs[index+1].id);
    else if(action==='detach'&&id!=='draft')onDetach(id);
    else if(action==='organize')onOrganize?.();
    else if(action==='close')tab.onClose?.();
    else onTabAction?.(id,action);
  };
  const tabMenu=(id:string)=><MenuButton className="aui-tab-menu" label={`Options for ${tabs.find(tab=>tab.id===id)!.label}`} placement="top-end"
    items={itemsFor(id)} onSelect={action=>choose(id,action)}><AetherIcon name="chevron" style={{transform:'rotate(90deg)'}}/></MenuButton>;
  const openContext=(target:Element,x?:number,y?:number)=>{
    const id=tabAt(target);if(!id)return false;
    const tab=target.closest('.aui-document-tab')!.querySelector<HTMLElement>('[role="tab"]')!;
    tab.focus();const bounds=tab.getBoundingClientRect();
    gesture.current=null;setGhost(null);
    setContext({id,x:x??bounds.left,y:y??bounds.top});return true;
  };
  const presented = tabs.map(tab => ({...tab,
    // Closing remains in the per-document menu, alongside the other CAD actions.
    onClose: undefined,
    detail:[tab.detail ?? 'CAD document',revisionForTab?.(tab.id).label].filter(Boolean).join(' · '),
    status:tab.current?saveStatus:undefined,
    icon:tab.icon,
  }));
  return <div className="cad-document-tray" data-save-tone={saveTone}
    onContextMenu={event=>{if(event.target instanceof Element&&openContext(event.target,event.clientX,event.clientY)){event.preventDefault();event.stopPropagation();}}}
    onDragStart={event=>event.preventDefault()}
    onPointerDown={event=>{
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest('.aui-document-tab-close, .aui-tab-menu, [role="menu"]')) return;
      const id = tabAt(event.target);
      if (id) { gesture.current={id,x:event.clientX,y:event.clientY,dragging:false}; suppressClick.current=false; }
    }}
    onPointerMove={event=>{
      const start = gesture.current; if (!start) return;
      if (!start.dragging && Math.hypot(event.clientX-start.x,event.clientY-start.y)<8) return;
      start.dragging=true; suppressClick.current=true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setGhost({label:tabs.find(tab=>tab.id===start.id)?.label ?? '',x:event.clientX,y:event.clientY});
    }}
    onPointerCancel={()=>{gesture.current=null;setGhost(null);}}
    onPointerUp={event=>{
      const start=gesture.current; gesture.current=null; setGhost(null);
      if (!start?.dragging) return;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const bounds=event.currentTarget.getBoundingClientRect();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      const hit=document.elementFromPoint(event.clientX,event.clientY);
      const target=tabAt(hit);
      const folder=hit?.closest<HTMLElement>('[data-tab-folder]')?.dataset.tabFolder;
      if(folder) onFoldersChange?.(assignTabFolder(folders,start.id,folder));
      else if(target) onFoldersChange?.(assignTabFolder(folders,start.id,''));
      if (target && target!==start.id) onReorder(start.id,target);
      else if(event.clientY<bounds.top-48 || event.clientY>bounds.bottom+48) onDetach(start.id);
    }}
    onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}}
    onKeyDownCapture={event=>{
      if((event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))&&event.target instanceof Element&&openContext(event.target)){event.preventDefault();event.stopPropagation();return;}
      if(event.key==='Escape'){gesture.current=null;setGhost(null);}
      if(!event.altKey || !['ArrowLeft','ArrowRight'].includes(event.key) || !(event.target instanceof Element)) return;
      const id=tabAt(event.target), index=tabs.findIndex(tab=>tab.id===id);
      const target=tabs[index+(event.key==='ArrowLeft'?-1:1)];
      if(id && target){event.preventDefault();event.stopPropagation();onReorder(id,target.id);}
    }}>
    <DocumentTabBar variant="studio" placement={placement} ariaLabel={label} tabs={presented}
      addLabel="Create or open a design" addItems={[{id:'create',label:'Create new design…'}, ...(onManage?[{id:'manage',label:'Manage and import files…'}]:[])]}
      onAdd={id=>{if(id==='create')onAdd();else if(id==='manage')onManage?.();}}
      renderTabActions={tab=>tabMenu(tab.id)}
      renderTabs={folders.length ? props => <div className="aui-document-tab-groups">
        <DocumentTabs {...props} tabs={props.tabs.filter(tab=>!folders.some(folder=>folder.tabs.includes(tab.id)))}/>
        {folders.map(folder=><div className="cad-tab-folder" data-tab-folder={folder.id} key={folder.id}>
          <button className="cad-tab-folder-label" aria-expanded={!folder.collapsed} title={`${folder.name} — click to ${folder.collapsed?'expand':'collapse'}`} onClick={()=>onFoldersChange?.(folders.map(item=>item.id===folder.id?{...item,collapsed:!item.collapsed}:item))}><AetherIcon name="folder"/>{folder.name||'Untitled folder'} <small>{tabs.filter(tab=>folder.tabs.includes(tab.id)).length}</small></button>
          <DocumentTabs {...props} tabs={props.tabs.filter(tab=>folder.tabs.includes(tab.id)&&(!folder.collapsed||tab.id===current?.id))}/>
        </div>)}
      </div> : undefined}
      trailing={<>
        {onOrganize&&<button aria-label="Organize tabs" title="Folder manager" onClick={onOrganize}><AetherIcon name="folder"/></button>}
        {onManage&&<button aria-label="Manage files" title="Manage and import files" onClick={onManage}><AetherIcon name="part-manager"/></button>}
        {leading}
      </>}/>
    <Menu open={Boolean(context)} anchor={context} applicationCommands={false} ariaLabel={`Tab options for ${tabs.find(tab=>tab.id===context?.id)?.label??''}`}
      items={context?itemsFor(context.id):[]} onSelect={action=>{if(context)choose(context.id,action);}} onClose={()=>setContext(null)}/>
    {ghost && <div className="cad-tab-drag-preview" style={{left:ghost.x+12,top:ghost.y-36}}>{ghost.label}</div>}
  </div>;
}
