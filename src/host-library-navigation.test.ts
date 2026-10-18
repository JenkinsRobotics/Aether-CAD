// @vitest-environment jsdom
import {beforeEach,expect,test,vi} from 'vitest';
const request=vi.hoisted(()=>vi.fn());
vi.mock('@aether/session/documents',()=>({documentRequest:request}));
vi.mock('@aether/session/autosave',()=>({
  AutosaveSession:class { dirty=false; state={durable:true}; dispose(){} subscribe(){} async flush(){} updateBase(){} pause(){} },
  readRecovery:()=>null, recoveryKey:()=> 'test', sessionOwner:async()=> 'user',
}));
beforeEach(()=>{
 vi.resetModules();history.replaceState(null,'','/cad/index.html?document=old');
 request.mockReset();request.mockImplementation(async(_app,_action,data)=>({id:data.id,name:data.id+'.acpart',revision:1,writable:true,data_base64:btoa('{}')}));
});
test('a failed target read keeps the previous document writable and never replaces the editor',async()=>{
 const host=await import('./host-library');await host.loadHostedFile();host.markHostedClean();
 request.mockRejectedValueOnce(new Error('Unavailable'));
 const open=vi.fn();await expect(host.switchHostedDocument(new URL('/cad/index.html?document=new',location.href),open)).rejects.toThrow('Unavailable');
 expect(open).not.toHaveBeenCalled();expect((await import('./document-session')).documentSession()?.id).toBe('old');
});
test('a partial editor failure reopens the saved previous document under its original identity',async()=>{
 const host=await import('./host-library');await host.loadHostedFile();host.markHostedClean();
 const open=vi.fn(async(file:File)=>{if(file.name==='new.acpart')throw new Error('Engine failure');});
 await expect(host.switchHostedDocument(new URL('/cad/index.html?document=new',location.href),open)).rejects.toThrow('Engine failure');
 expect(open.mock.calls.map(call=>call[0].name)).toEqual(['new.acpart','old.acpart']);
 expect((await import('./document-session')).documentSession()?.id).toBe('old');
});
