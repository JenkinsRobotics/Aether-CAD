import type { TabFolder } from '@aether/ui';
export { assignTabFolder, type TabFolder } from '@aether/ui';
/** A browser browsing context owns its tabs, including when sessionStorage was copied by an opener. */
export const OPEN_FILES_KEY = 'aether-cad.open-files';
export function initializeTabSession(storage: Storage, context: {name:string}, makeID:()=>string=()=>crypto.randomUUID()) {
  const ownerKey='aether-cad.tab-owner';
  if (!context.name.startsWith('aether-cad-tabs:') || storage.getItem(ownerKey)!==context.name) {
    context.name=`aether-cad-tabs:${makeID()}`;
    storage.removeItem(OPEN_FILES_KEY);
    storage.removeItem('aether-cad.tab-groups:files');
    storage.setItem(ownerKey,context.name);
  }
}
export function browserTabStorage(): Storage {
  initializeTabSession(window.sessionStorage,window);
  return window.sessionStorage;
}
export function readTabFolders(storage:Storage,key:string):TabFolder[] {
  try {
    const data:unknown=JSON.parse(storage.getItem(key)??'[]');
    return Array.isArray(data)?data.filter((v):v is TabFolder=>Boolean(v)&&typeof v.id==='string'&&typeof v.name==='string'&&Array.isArray(v.tabs)&&v.tabs.every((id:unknown)=>typeof id==='string')&&typeof v.collapsed==='boolean'):[];
  } catch {return [];}
}
