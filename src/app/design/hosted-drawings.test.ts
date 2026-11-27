import { beforeEach, expect, it, vi } from 'vitest';
import { createRectanglePartDocument } from '@aether/core/document';
import { createDrawingDocument } from '@aether/core/drawing';
import { persistDesignDrawing } from './hosted-drawings';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@aether/session/documents',()=>({documentRequest:mocks.request}));
const source=createRectanglePartDocument('Bracket',{widthMillimeters:20,heightMillimeters:10,depthMillimeters:5});
beforeEach(()=>{vi.restoreAllMocks();mocks.request.mockReset();});
it('updates only the inspected Hybrid archive and preserves branch/revision authority',async()=>{
 const drawing=createDrawingDocument(source),contained={...drawing,documentId:'drawing-1'};
 mocks.request.mockResolvedValueOnce({data_base64:'base'}).mockResolvedValueOnce({id:'design',revision:8,writable:true});
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ok:true,archive:{revision:'5',data_base64:'base'}})))
 .mockResolvedValueOnce(new Response(JSON.stringify({ok:true,result:{parts:[],assemblies:[],drawings:[{id:'drawing-1',document:contained}]},archive:{data_base64:'updated'}})));
 const result=await persistDesignDrawing({id:'design',name:'Design.acad',revision:7,writable:true},'Prototype',drawing);
 expect(result.id).toBe('drawing-1');
 expect(mocks.request.mock.calls).toEqual([
 ['cad','read_revision',{id:'design',revision:7,branch:'Prototype'}],
 ['cad','save',{id:'design',expected_revision:7,branch:'Prototype',data_base64:'updated'}],
 ]);
 expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({method:'add_drawing',params:{expected_revision:'5',document:{format:'aether-drawing'}}});
});
it('refuses read-only designs before transforming or creating any file',async()=>{
 await expect(persistDesignDrawing({id:'design',name:'Design.acad',revision:1,writable:false},undefined,createDrawingDocument(source))).rejects.toThrow('read-only');
 expect(mocks.request).not.toHaveBeenCalled();
});
it('keeps a concurrent save conflict rather than retrying against a newer base',async()=>{
 mocks.request.mockResolvedValueOnce({data_base64:'base'}).mockRejectedValueOnce(Error('changed elsewhere'));
 vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({ok:true,archive:{revision:'1',data_base64:'changed'},result:{}})));
 await expect(persistDesignDrawing({id:'design',name:'Design.acad',revision:7,writable:true},undefined,createDrawingDocument(source),'drawing-1')).rejects.toThrow('changed elsewhere');
 expect(mocks.request).toHaveBeenCalledTimes(2);
});
