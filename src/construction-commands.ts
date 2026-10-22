import type { PartDocument } from '@aether/core/document';
import { cadCommands } from './cad-command-registry';
import { openPlaneWindow } from './plane-window';
import { openAxisWindow } from './axis-window';
import { openPointWindow } from './point-window';
/** Named workflows share the same validated plane editor and document apply path. */
export function mountConstructionCommands(getDocument:()=>PartDocument|null,apply:(doc:PartDocument)=>Promise<void>) {
 const dispose = (['angle','mid','three-point','perpendicular','two-edges','tangent','along-path'] as const).map(method=>{
  const id=`construction-plane-${method}` as const;
  const release=cadCommands.register(id,()=>{void openPlaneWindow(getDocument,apply,undefined,method);});
  cadCommands.setEnabled(id,true);
  return release;
 });
 const axes = (['edge','two-points','normal-to-plane','two-planes'] as const).map(method=>{
  const id=`construction-axis-${method}` as const;
  const release=cadCommands.register(id,()=>{void openAxisWindow(getDocument,apply,undefined,method);});
  cadCommands.setEnabled(id,true);
  return release;
 });
 const points = (['vertex','two-edges','three-planes','center','edge-plane','along-path'] as const).map(method=>{
  const id=`construction-point-${method}` as const;
  const release=cadCommands.register(id,()=>{void openPointWindow(getDocument,apply,undefined,method);});
  cadCommands.setEnabled(id,true);
  return release;
 });
 return ()=>[...dispose,...axes,...points].forEach(release=>release());
}
