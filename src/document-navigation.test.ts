// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { configureDocumentNavigation, navigateDocument } from './document-navigation';
beforeEach(()=>{history.replaceState(null,'','/cad/index.html?document=a');});
test('changes URL only after the in-place loader succeeds',async()=>{
  const loader=vi.fn(async()=>{expect(location.search).toBe('?document=a');});
  configureDocumentNavigation(loader);
  const changed=vi.fn(); window.addEventListener('cad-document-navigation',changed,{once:true});
  await navigateDocument('/cad/index.html?document=b');
  expect(loader).toHaveBeenCalledOnce(); expect(location.search).toBe('?document=b'); expect(changed).toHaveBeenCalledOnce();
});
test('failed loading leaves the current address intact',async()=>{
  configureDocumentNavigation(async()=>{throw new Error('Save conflict');});
  await expect(navigateDocument('/cad/index.html?document=b')).rejects.toThrow('Save conflict');
  expect(location.search).toBe('?document=a');
});
test('competing tab loads cannot race document identity',async()=>{
  let done!:()=>void;
  configureDocumentNavigation(()=>new Promise<void>(resolve=>{done=resolve;}));
  const first=navigateDocument('/cad/index.html?document=b');
  await expect(navigateDocument('/cad/index.html?document=c')).rejects.toThrow('Wait');
  done(); await first; expect(location.search).toBe('?document=b');
});
