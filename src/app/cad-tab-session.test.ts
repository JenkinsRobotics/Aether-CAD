// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {initializeTabSession,OPEN_FILES_KEY,assignTabFolder,readTabFolders} from './cad-tab-session';
beforeEach(()=>sessionStorage.clear());
it('keeps same-window tabs on reload but resets an opener-copied session in a new window',()=>{
 const original={name:''};initializeTabSession(sessionStorage,original,()=> 'first');
 sessionStorage.setItem(OPEN_FILES_KEY,'[{"id":"a"},{"id":"b"}]');
 initializeTabSession(sessionStorage,original,()=> 'unused');
 expect(JSON.parse(sessionStorage.getItem(OPEN_FILES_KEY)!)).toHaveLength(2);
 const child={name:''};initializeTabSession(sessionStorage,child,()=> 'second');
 expect(sessionStorage.getItem(OPEN_FILES_KEY)).toBeNull();
 expect(child.name).not.toBe(original.name);
});
it('moves membership between folders once and ungrouping retains tabs as ungrouped',()=>{
 const groups=[{id:'a',name:'Fixtures',tabs:['p'],collapsed:false},{id:'b',name:'Hardware',tabs:[],collapsed:true}];
 const moved=assignTabFolder(groups,'p','b');expect(moved.map(g=>g.tabs)).toEqual([[],['p']]);
 expect(assignTabFolder(moved,'p','').map(g=>g.tabs)).toEqual([[],[]]);
 sessionStorage.setItem('groups',JSON.stringify(moved));expect(readTabFolders(sessionStorage,'groups')).toEqual(moved);
});
it('rejects malformed stored folders',()=>{sessionStorage.setItem('groups','[{"id":"x","tabs":42}]');expect(readTabFolders(sessionStorage,'groups')).toEqual([]);});
