/** Persisted interchange source; geometry is decoded only by the native adapter. */
export type CADImportFormat = 'step' | 'iges' | 'brep' | 'stl' | 'obj' | 'ply' | 'off';
export type MeshImportUnits = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export interface ImportCADFeature {
  id:string; type:'import-cad'; name:string; suppressed:boolean; operation:'new';
  bodyId:string; sourceName:string; dataBase64:string; format:CADImportFormat;
  meshMode?:'reference'|'solid'; meshUnits?:MeshImportUnits;
}
export const cadImportExtensions:Record<CADImportFormat,readonly string[]> = {
  step:['step','stp'],iges:['iges','igs'],brep:['brep','brp'],stl:['stl'],obj:['obj'],ply:['ply'],off:['off'],
};
export const isMeshImportFormat = (format:CADImportFormat) => ['stl','obj','ply','off'].includes(format);
export function validateImportCAD(feature:ImportCADFeature):void {
  if(feature.operation!=='new'||typeof feature.bodyId!=='string'||!feature.bodyId.trim())throw Error('CAD import needs a unique body identity.');
  const extensions=cadImportExtensions[feature.format];
  if(!Array.isArray(extensions)||typeof feature.sourceName!=='string'||!extensions.includes(feature.sourceName.split('.').at(-1)!.toLowerCase()))throw Error('CAD import format must match its source filename.');
  if(typeof feature.dataBase64!=='string'||!feature.dataBase64.length||feature.dataBase64.length>4*1024*1024||feature.dataBase64.length%4!==0||/[^A-Za-z0-9+/=]/.test(feature.dataBase64)||/=/.test(feature.dataBase64.slice(0,-2))||/=[^=]$/.test(feature.dataBase64))throw Error('Invalid CAD source (maximum 3 MiB per import).');
  if(isMeshImportFormat(feature.format)) {
    if(!['reference','solid'].includes(feature.meshMode??'')||!['mm','cm','m','in','ft'].includes(feature.meshUnits??''))throw Error('Mesh imports need explicit units and a mesh or solid interpretation.');
  } else if(feature.meshMode!==undefined||feature.meshUnits!==undefined)throw Error('Exact CAD imports use their source units, without mesh conversion settings.');
}
