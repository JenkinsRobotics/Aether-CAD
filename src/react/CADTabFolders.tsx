import {useState} from 'react';
import {Button, Dialog, AetherIcon, type DocumentElementTab} from '@aether/ui';
import {assignTabFolder, type TabFolder} from '../cad-tab-session';

/** Tab organization only; folders never move files or alter hybrid design links. */
export function CADTabFolders({tabs,folders,onChange,onClose}:{tabs:DocumentElementTab[];folders:TabFolder[];onChange:(folders:TabFolder[])=>void;onClose:()=>void}) {
 const [name,setName]=useState('');
 return <Dialog open title="Organize tabs" onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
  <div className="cad-tab-folders-editor">
   <p>Group tabs in folders. Files and Hybrid Design links stay in their current locations.</p>
   <form onSubmit={event=>{event.preventDefault();if(name.trim()){onChange([...folders,{id:crypto.randomUUID(),name:name.trim(),tabs:[],collapsed:false}]);setName('');}}}>
    <input aria-label="New tab folder name" placeholder="Folder name" value={name} onChange={event=>setName(event.target.value)} maxLength={80}/><Button type="submit" disabled={!name.trim()}>New folder</Button>
   </form>
   {folders.map(folder=><div className="cad-tab-folder-edit" key={folder.id}><AetherIcon name="folder"/><input aria-label={`Rename ${folder.name}`} value={folder.name} onChange={event=>onChange(folders.map(item=>item.id===folder.id?{...item,name:event.target.value}:item))} maxLength={80}/><Button onClick={()=>onChange(folders.filter(item=>item.id!==folder.id))}>Ungroup</Button></div>)}
   {tabs.map(tab=><label className="cad-tab-folder-edit" key={tab.id}><span>{tab.label}</span><select aria-label={`Folder for ${tab.label}`} value={folders.find(folder=>folder.tabs.includes(tab.id))?.id??''} onChange={event=>onChange(assignTabFolder(folders,tab.id,event.target.value))}><option value="">Ungrouped</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.name||'Untitled folder'}</option>)}</select></label>)}
  </div>
 </Dialog>;
}
