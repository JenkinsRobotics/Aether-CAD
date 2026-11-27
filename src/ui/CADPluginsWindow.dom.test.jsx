// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {CADPluginsWindow} from './CADPluginsWindow';
beforeEach(()=>vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true));
let root,host;
afterEach(async()=>{if(root)await act(()=>root.unmount());host?.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(path, response) {
 window.history.replaceState(null,'',path);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>response}));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const close=vi.fn();await act(async()=>root.render(<CADPluginsWindow onClose={close}/>));return close;
}
test('standalone displays unavailable state without contacting Studio',async()=>{
 await mount('/index.html',{});
 expect(fetch).not.toHaveBeenCalled();
 expect(host.textContent).toContain('Standalone plugin installation is not implemented');
 expect(host.querySelector('iframe')).toBeNull();
});
test('hosted popup requires app access and accepts close only from its own frame',async()=>{
 const close=await mount('/cad/index.html',{user:{id:'one'},apps:[{id:'cad',enabled:true}]});
 const frame=host.querySelector('iframe');expect(frame).not.toBeNull();
 await act(()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:window,data:{type:'aether-close-plugins'}})));
 expect(close).not.toHaveBeenCalled();
 await act(()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'aether-close-plugins'}})));
 expect(close).toHaveBeenCalledOnce();
});
