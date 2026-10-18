import {describe,it,expect,vi} from 'vitest';
import {availableBodies,parsePartDocument,serializePartDocument,setFeatureSuppressed,removeFeature,validatePartDocument} from '@aether/core/document';
import {appendCAD,importFormat,CAD_IMPORT_ACCEPT} from './cad-import';
import {configureCADImport,importCADFiles,queueCADImport,importFilesSnapshot,clearImportFiles} from './cad-import-service';
import {translateDocument} from '../freecad-translate';
import type {ImportedModelData} from '../domain';
const options={meshUnits:'in',meshMode:'reference'} as const;
const file=(name='mesh.STL')=>new File(['fixture'],name);
const model={parts:[],parseMilliseconds:1} as unknown as ImportedModelData;

describe('persisted CAD interchange imports',()=>{
 it('preserves original bytes, units, interpretation, stable identities and history through save/reopen',async()=>{
  const first=await appendCAD(null,[file()],options),second=await appendCAD(first,[file('solid.stp')],options);
  expect(first.features).toHaveLength(1);
  const opened=parsePartDocument(serializePartDocument(second));
  expect(availableBodies(opened).map(b=>b.id)).toEqual(availableBodies(second).map(b=>b.id));
  expect(opened.features[0]).toMatchObject({type:'import-cad',format:'stl',dataBase64:btoa('fixture'),meshUnits:'in',meshMode:'reference'});
  expect(translateDocument(opened)).toMatchObject({complete:true,features:[{kind:'import-cad',parameters:{format:'stl',mesh_units:'in',mesh_mode:'reference'}},{kind:'import-cad',parameters:{format:'step'}}]});
  expect(availableBodies(setFeatureSuppressed(opened,opened.features[0].id,true))).toHaveLength(1);
  expect(availableBodies(removeFeature(opened,opened.features[0].id))).toHaveLength(1);
 });
 it('recognizes aliases and gives a usable route for native proprietary and 2D sources',()=>{
  for(const [name,format] of [['part.STP','step'],['p.IGS','iges'],['p.brp','brep'],['p.OBJ','obj'],['p.ply','ply'],['p.off','off']])expect(importFormat(name)).toBe(format);
  expect(CAD_IMPORT_ACCEPT).toContain('.stl');
  expect(()=>importFormat('part.sldprt')).toThrow(/Export STEP/);
  expect(()=>importFormat('assembly.sldasm')).toThrow(/Export STEP/);
  expect(()=>importFormat('profile.dxf')).toThrow(/Sketch/);
 });
 it('rejects malformed saved contracts and oversized or partially invalid batches without mutating the original',async()=>{
  const first=await appendCAD(null,[file()],options),before=serializePartDocument(first);
  await expect(appendCAD(first,[file('one.step'),file('two.sldprt')],options)).rejects.toThrow(/Export STEP/);
  expect(serializePartDocument(first)).toBe(before);
  await expect(appendCAD(first,[new File([],'empty.stl')],options)).rejects.toThrow(/nonempty/);
  await expect(appendCAD(first,[new File([new Uint8Array(3*1024*1024+1)],'big.stl')],options)).rejects.toThrow(/3 MiB/);
  for(const patch of [{meshUnits:undefined},{meshMode:undefined},{format:'__proto__'},{sourceName:'wrong.step'},{dataBase64:'a==='}]){
   const invalid=structuredClone(first);Object.assign(invalid.features[0],patch);
   expect(()=>validatePartDocument(invalid)).toThrow();
  }
  const budget=[new File([new Uint8Array(1700*1024)],'one.stl'),new File([new Uint8Array(1700*1024)],'two.stl')];
  await expect(appendCAD(null,budget,options)).rejects.toThrow(/4 MiB/);
 });
});

describe('atomic import controller',()=>{
 it('commits the evaluated batch once',async()=>{
  const current=await appendCAD(null,[file('existing.step')],options),commit=vi.fn(),evaluate=vi.fn(async()=>model);
  configureCADImport({current:()=>current,available:()=>true,evaluate,commit});
  await importCADFiles([file(),file('extra.obj')],options);
  expect(evaluate).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0][0].features).toHaveLength(3);expect(current.features).toHaveLength(1);
 });
 it('does not commit native failures, cancellation, or edits made during evaluation',async()=>{
  for(const cause of ['failure','cancel','edit','closed'] as const){
   const current=await appendCAD(null,[file()],options),commit=vi.fn(),controller=new AbortController();let available=true;
   configureCADImport({current:()=>current,available:()=>available,commit,evaluate:async()=>{
    if(cause==='failure')throw Error('Invalid source geometry');
    if(cause==='cancel')controller.abort();
    if(cause==='edit')current.name='Edited during import';
    if(cause==='closed')available=false;
    return model;
   }});
   await expect(importCADFiles([file()],options,controller.signal)).rejects.toThrow();
   expect(commit).not.toHaveBeenCalled();expect(current.features).toHaveLength(1);
  }
 });
 it('protects an in-flight file selection from a second drop and rejects concurrent execution',async()=>{
  let finish!:(value:ImportedModelData)=>void;const wait=new Promise<ImportedModelData>(r=>{finish=r;});
  configureCADImport({current:()=>null,available:()=>true,evaluate:()=>wait,commit:vi.fn()});
  const selected=[file()];queueCADImport(selected);
  const pending=importCADFiles(selected,options);queueCADImport([file('dropped.obj')]);
  expect(importFilesSnapshot()).toEqual(selected);
  await expect(importCADFiles(selected,options)).rejects.toThrow(/already running/);
  finish(model);await pending;clearImportFiles();
 });
});
