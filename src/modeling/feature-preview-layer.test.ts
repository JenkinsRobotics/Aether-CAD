import {visiblePreviewBounds} from '../viewport/orientation-preview';
import {expect,it,vi} from 'vitest';
import {Mesh} from 'three/webgpu';
import {FeaturePreviewLayer,previewColors} from './feature-preview-layer';
import type {ImportedModelData,PartGeometryData} from '../domain';
const part=(id:string):PartGeometryData=>({id,name:id,sourceDocumentId:'preview',sourceName:'Preview',vertices:new Float32Array([0,0,0,1,0,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),triangles:new Uint32Array([0,1,2]),edgeLines:new Float32Array([0,0,0,1,0,0]),faceRanges:[],topology:[]});
const model:ImportedModelData={sourceName:'Part',parseMilliseconds:0,parts:[part('real')],featurePreview:{base:[part('preview:base:target'),part('preview:base:other')],added:[part('preview:added:target')],removed:[part('preview:removed:target')]}};
it('draws blue addition and red removal volumes, ghosting only the cut target',()=>{
 const layer=new FeaturePreviewLayer();layer.set(model);
 const meshes=layer.group.children.filter((o):o is Mesh=>o instanceof Mesh);
 expect(meshes.map(m=>m.userData.previewRole)).toEqual(['base','base','added','removed']);
 const materials=meshes.map(m=>m.material as import('three/webgpu').MeshStandardMaterial);
 expect(materials.map(m=>m.color.getHex())).toEqual([previewColors.base,previewColors.base,previewColors.added,previewColors.removed]);
 expect(materials.map(m=>m.opacity)).toEqual([0.35,1,0.55,0.55]);
 expect(materials.map(m=>m.depthWrite)).toEqual([false,true,false,false]);
 expect(model.parts[0].id).toBe('real');
});
it('disposes temporary geometry/materials on update and cancel and restores neutral history rendering',()=>{
 const layer=new FeaturePreviewLayer();layer.set(model);
 const old=layer.group.children[0] as Mesh;
 const geometry=vi.spyOn(old.geometry,'dispose'),material=vi.spyOn(old.material as any,'dispose');
 layer.set(model,false);
 expect(geometry).toHaveBeenCalledOnce();expect(material).toHaveBeenCalledOnce();
 expect(layer.group.children).toHaveLength(2);
 expect((layer.group.children[0] as Mesh).userData.previewRole).toBe('base');
 layer.set(null);expect(layer.active).toBe(false);expect(layer.group.children).toHaveLength(0);
});

it('keeps reference meshes visible while showing exact solid changes',()=>{
 const layer=new FeaturePreviewLayer();
 const mesh={...part('reference'),geometryKind:'mesh' as const};
 layer.set({...model,parts:[...model.parts,mesh]});
 const shown=layer.group.children.filter((o):o is Mesh=>o instanceof Mesh);
 const reference=shown.find(m=>m.userData.previewPartId==='reference')!;
 expect(reference).toBeTruthy();expect(reference.userData.previewRole).toBe('base');
 expect((reference.material as import('three/webgpu').MeshStandardMaterial).opacity).toBe(1);
 layer.set({...model,parts:[mesh],featurePreview:{base:[],added:[],removed:[]}});
 expect(layer.group.children.filter(o=>o instanceof Mesh)).toHaveLength(1);
 layer.set(null);
});

it('hides reference surfaces and edges while keeping blue/red changes visible, then restores visibility',()=>{
 const layer=new FeaturePreviewLayer();layer.set({...model,parts:[...model.parts,{...part('mesh'),geometryKind:'mesh'}]});
 layer.setVisibility(id=>!['other','mesh','target'].includes(id));
 expect(layer.group.children.filter(o=>o.visible).map(o=>o.userData.previewRole)).toEqual(['added','added','removed','removed']);
 layer.setVisibility(()=>true);
 expect(layer.group.children.every(o=>o.visible)).toBe(true);
 layer.set(null);expect(layer.group.children).toHaveLength(0);
});

it('frames the changed material without distant hidden reference parts',()=>{
 const layer=new FeaturePreviewLayer(),far=part('preview:base:hidden');far.vertices=far.vertices.map(value=>value+1000);
 layer.set({...model,featurePreview:{base:[far],added:[part('preview:added:new')],removed:[]}});
 layer.setVisibility(id=>id!=='hidden');expect(visiblePreviewBounds([layer.group]).max.x).toBe(1);
 layer.setVisibility(()=>true);expect(visiblePreviewBounds([layer.group]).max.x).toBe(1001);
 layer.set(null);
});
