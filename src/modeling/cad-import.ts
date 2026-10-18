import {cadImportExtensions,isMeshImportFormat,createEmptyPartDocument,insertFeature,validatePartDocument,type PartDocument,type CADImportFormat,type MeshImportUnits} from '@aether/core/document';

export const CAD_IMPORT_ACCEPT = Object.values(cadImportExtensions).flat().map(x=>'.'+x).join(',');
export interface CADImportOptions {meshUnits:MeshImportUnits; meshMode:'reference'|'solid'}
export function importFormat(name:string):CADImportFormat {
  const extension=name.split('.').at(-1)?.toLowerCase();
  const found=Object.entries(cadImportExtensions).find(([,extensions])=>extensions.includes(extension??''));
  if(found)return found[0] as CADImportFormat;
  if(['sldprt','sldasm','slddrw','x_t','x_b','sat','sab','ipt','iam','catpart','catproduct','prt','asm'].includes(extension??''))throw Error(`${name}: this native CAD format needs a translator. Export STEP (.step or .stp) from the source CAD application, then import it here.`);
  if(['svg','dxf'].includes(extension??''))throw Error(`${name}: use Sketch → Import SVG/DXF to import 2D profiles.`);
  if(['acpart','cadpart','acad','acasm','aether'].includes(extension??''))throw Error(`${name}: use Open Part or Open Assembly for an Aether document.`);
  throw Error(`${name}: unsupported format. Choose STEP, IGES, BREP, STL, OBJ, PLY or OFF.`);
}
export {isMeshImportFormat};
export async function appendCAD(document:PartDocument|null,files:readonly File[],options:CADImportOptions):Promise<PartDocument> {
  if(!files.length)throw Error('Choose at least one CAD file.');
  if(files.length>32)throw Error('Import at most 32 files at a time.');
  let next=document;
  for(const file of files) {
    const format=importFormat(file.name);
    if(!file.size||file.size>3*1024*1024)throw Error(`${file.name}: source must be nonempty and at most 3 MiB.`);
    const bytes=new Uint8Array(await file.arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    const name=file.name.replace(/\.[^.]+$/,'');
    const base=next??createEmptyPartDocument(name),id=crypto.randomUUID(),bodyId=`${base.documentId}:body-${id}`;
    next=insertFeature(base,{id,type:'import-cad',name:`Import ${file.name}`,sourceName:file.name,format,dataBase64:btoa(binary),operation:'new',suppressed:false,bodyId,
      ...(isMeshImportFormat(format)?{meshUnits:options.meshUnits,meshMode:options.meshMode}:{})});
    next.bodyProperties={...next.bodyProperties,[bodyId]:{name,visible:true}};
    if(new TextEncoder().encode(JSON.stringify(next,null,2)).length>4*1024*1024)throw Error('The resulting Part exceeds the 4 MiB saved-document budget. Import fewer or smaller files into a separate Part.');
    validatePartDocument(next);
  }
  return next!;
}
