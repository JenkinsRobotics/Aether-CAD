import { beforeEach, expect, it, vi } from 'vitest';
import { createEmptyPartDocument } from '@aether/core/document';
import { deleteTab, duplicateTab, editTabProperties, loadTabMetadata, prepareTabDeletion, tabActionItems, tabPartCode, tabURL, type CADTabTarget } from './document-tab-actions';
import type { Metadata } from './react/CADDocumentSettings';
const mocks=vi.hoisted(()=>({request:vi.fn(),recycle:vi.fn(),snapshot:vi.fn()}));
vi.mock('@aether/session/documents',()=>({documentRequest:mocks.request,fileRecycleRequest:mocks.recycle,decodeDocument:(s:string)=>Buffer.from(s,'base64').toString()}));
vi.mock('./host-library',()=>({currentEditorSnapshot:mocks.snapshot}));
const target:CADTabTarget={id:'part-b',name:'Bracket',kind:'part',current:false,documentId:'file-b',itemId:'part-b',branch:'Design B'};
const meta=():Metadata=>({id:'file-b',name:'Design.acad',revision:7,writable:true,scope:'personal',parent:null,deleted:[],featureVersion:3,upgradeDocuments:{},upgradeNeeded:false,updates:[],settings:{description:'',revisionManaged:true,workspaceName:'Main',workspaceDescription:'',units:{},itemQuantities:{'part-b':{mass:4}}},items:[{id:'part-b',name:'Bracket',description:'keep',category:'Metal',kind:'part'}]} as Metadata);
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>meta()})));});
it('lists the reference commands and gives truthful availability for drafts, history and unsupported storage',()=>{
 const items=tabActionItems(target);
 expect(items.map(i=>i.label)).toEqual(['Delete','Open in new browser tab','Rename','Properties…','Show code','Duplicate','Copy to clipboard','Select as document thumbnail','Move to document…']);
 expect(items.filter(i=>i.disabled).map(i=>i.id)).toEqual(['thumbnail','move-document']);
 expect(items.filter(i=>i.disabled).every(i=>Boolean(i.disabledReason))).toBe(true);
 const historical=tabActionItems({...target,revision:4});expect(historical.find(i=>i.id==='delete')?.disabled).toBe(true);
 expect(historical.find(i=>i.id==='code')?.disabled).toBe(false);
 const draft=tabActionItems({...target,documentId:null,itemId:undefined});expect(draft.find(i=>i.id==='open-browser')?.disabled).toBe(true);
 expect(draft.find(i=>i.id==='code')?.disabled).toBe(false);
});
it('builds a target-specific URL retaining branch and selected history',()=>{
 expect(tabURL({...target,revision:3})).toBe('/cad/index.html?document=file-b&part=part-b&branch=Design+B&revision=3');
 expect(()=>tabURL({...target,documentId:null})).toThrow('Save');
});
it('loads metadata for the clicked document and not the active location',async()=>{
 await loadTabMetadata({...target,revision:5});
 expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({id:'file-b',branch:'Design B',revision:5});
});
it('renames only the chosen element and preserves its properties and quantities',async()=>{
 await editTabProperties(target,meta(),{name:'Renamed',description:'keep',category:'Metal'},true);
 expect(mocks.request).toHaveBeenCalledWith('cad','cad_operation',expect.objectContaining({id:'file-b',item_id:'part-b',expected_revision:7,branch:'Design B',operation:'properties',quantities:{mass:4}}));
});
it('renames standalone files using the document operation and rejects read-only mutations',async()=>{
 await editTabProperties({...target,itemId:undefined},meta(),{name:'File',description:'',category:''},true);
 expect(mocks.request.mock.calls[0][2]).toMatchObject({operation:'rename',id:'file-b',name:'File'});
 await expect(editTabProperties(target,{...meta(),writable:false},{name:'No',description:'',category:''})).rejects.toThrow('read-only');
 expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('reads exact selected Part JSON and refuses a missing project tab',async()=>{
 const part=createEmptyPartDocument('Bracket');mocks.request.mockResolvedValue({project:{parts:[{id:'part-b',document:part}]}});
 expect(JSON.parse(await tabPartCode({...target,revision:7}))).toMatchObject({name:'Bracket',format:'aether-part'});
 expect(mocks.request.mock.calls[0]).toEqual(['cad','project_read',{id:'file-b',branch:'Design B',revision:7}]);
 mocks.request.mockResolvedValue({project:{parts:[]}});await expect(tabPartCode(target)).rejects.toThrow('no editable Part');
});
it('reads unsaved code from the canonical editor snapshot',async()=>{
 mocks.snapshot.mockReturnValue({bytes:new TextEncoder().encode(JSON.stringify(createEmptyPartDocument('Draft')))});
 expect(JSON.parse(await tabPartCode({...target,current:true,documentId:null,itemId:undefined})).name).toBe('Draft');
 expect(mocks.request).not.toHaveBeenCalled();
});
it('duplicates a project part from the inspected revision using the canonical add operation',async()=>{
 mocks.request.mockResolvedValueOnce({project:{parts:[{id:'part-b',document:createEmptyPartDocument('Bracket')}]}}).mockResolvedValueOnce({id:'file-b',project:{parts:[{id:'new-part'}]}});
 expect(await duplicateTab(target,meta(),'Bracket copy')).toEqual({id:'file-b',itemId:'new-part'});
 expect(mocks.request.mock.calls[0][2]).toMatchObject({revision:7,branch:'Design B'});
 expect(mocks.request.mock.calls[1][2]).toMatchObject({operation:'add_part',expected_revision:7,name:'Bracket copy',id:'file-b',branch:'Design B'});
});
it('duplicates a standalone historical file without editing its original',async()=>{
 mocks.request.mockResolvedValue({id:'copy'});
 expect(await duplicateTab({...target,itemId:undefined,revision:3},{...meta(),revision:3,writable:false},'Copy')).toEqual({id:'copy'});
 expect(mocks.request.mock.calls[0][2]).toMatchObject({operation:'copy',revision:3,expected_revision:3,id:'file-b'});
});
it('deletes only the selected project element with the inspected revision',async()=>{
 const plan=await prepareTabDeletion(target,meta());await deleteTab(target,meta(),plan);
 expect(mocks.request.mock.calls[0][2]).toMatchObject({operation:'delete_item',item_id:'part-b',id:'file-b',expected_revision:7});
 expect(mocks.recycle).not.toHaveBeenCalled();
});
it('uses the inspected structural guard when recycling a standalone file and never silently retries',async()=>{
 const file={...target,itemId:undefined,branch:undefined};
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({id:'file-b',manageable:true,structure_revision:6})} as Response);
 const plan=await prepareTabDeletion(file,meta());mocks.recycle.mockRejectedValue(Error('Changed'));
 await expect(deleteTab(file,meta(),plan)).rejects.toThrow('Changed');
 expect(mocks.recycle).toHaveBeenCalledExactlyOnceWith('trash',{id:'file-b',expected_structure_revision:6});
});
it('refuses deleting files without owner authority and project tabs that disappeared',async()=>{
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({id:'file-b',manageable:false,structure_revision:6})} as Response);
 await expect(prepareTabDeletion({...target,itemId:undefined},meta())).rejects.toThrow('owner');
 await expect(prepareTabDeletion({...target,itemId:'missing'},meta())).rejects.toThrow('no longer exists');
 expect(mocks.recycle).not.toHaveBeenCalled();expect(mocks.request).not.toHaveBeenCalled();
});
