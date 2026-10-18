import type { PartDocument } from '@aether/core/document';
import { cadCommands } from './cad-command-registry';
import { openPlaneWindow } from './plane-window';
/** Named workflows share the same validated plane editor and document apply path. */
export function mountConstructionCommands(getDocument:()=>PartDocument|null,apply:(doc:PartDocument)=>Promise<void>) {
 const dispose = (['angle','mid','three-point'] as const).map(method=>{
  const id=`construction-plane-${method}` as const;
  const release=cadCommands.register(id,()=>{void openPlaneWindow(getDocument,apply,undefined,method);});
  cadCommands.setEnabled(id,true);
  return release;
 });
 return ()=>dispose.forEach(release=>release());
}
