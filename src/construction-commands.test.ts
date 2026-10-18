import {expect,it,vi} from 'vitest';
const open=vi.fn();
vi.mock('./plane-window',()=>({openPlaneWindow:(...args:unknown[])=>open(...args)}));
import {mountConstructionCommands} from './construction-commands';
import {cadCommands} from './cad-command-registry';
it('routes named methods through the plane editor and unregisters them',()=>{
 const current=()=>null,apply=vi.fn(),dispose=mountConstructionCommands(current,apply);
 try {for(const method of ['angle','mid','three-point'] as const){
  cadCommands.execute(`construction-plane-${method}`);
  expect(open).toHaveBeenLastCalledWith(current,apply,undefined,method);
 }}finally{dispose();}
 const count=open.mock.calls.length;cadCommands.execute('construction-plane-angle');expect(open).toHaveBeenCalledTimes(count);
});
