import {cadSelection} from '../cad-selection-store';
import {expect,it,vi} from 'vitest';
import * as THREE from 'three/webgpu';
import {FeaturePreviewLayer} from '../modeling/feature-preview-layer';
import {MateViewport} from '../viewer';
import {defaultCADAppearance} from '../cad-appearance-store';
import {resolveAppearance} from './appearance-themes';
import {resolvePartDisplay} from './part-display';

// Exercise the real picking/material methods without starting a GPU device.
function fixture() {
  const viewer=Object.create(MateViewport.prototype);
  viewer.featurePreview=new FeaturePreviewLayer();viewer.historyPreview=new FeaturePreviewLayer();
  viewer.modelRoot=new THREE.Group();viewer.parts=new Map();viewer.partDisplay=new Map();viewer.isolation=null;
  viewer.callbacks={onStateChanged:vi.fn(),onStatus:vi.fn()};
  viewer.renderer={domElement:{getBoundingClientRect:()=>({left:0,top:0,width:600,height:600})}};
  viewer.camera=new THREE.PerspectiveCamera(45,1,.1,1000);viewer.camera.position.set(0,0,10);viewer.camera.lookAt(0,0,0);viewer.camera.updateMatrixWorld();
  viewer.pointer=new THREE.Vector2();viewer.raycaster=new THREE.Raycaster();viewer.appearance=defaultCADAppearance;
  for(const [id,z] of [['near',2],['far',-2]] as const){
    const surface=new THREE.Mesh(new THREE.BoxGeometry(3,3,1),Array.from({length:6},()=>new THREE.MeshStandardMaterial({color:0xabcdef})));
    const group=new THREE.Group();group.position.z=z;group.add(surface);viewer.modelRoot.add(group);surface.userData.partId=id;
    viewer.parts.set(id,{data:{id,name:id,sourceDocumentId:'doc'},visible:true,group,surface,faceRanges:[{faceId:1,start:0,count:36}],edges:{material: new THREE.LineBasicMaterial(), visible: true}});
  }
  viewer.modelRoot.updateMatrixWorld(true);
  return viewer as Pick<MateViewport, 'contextPartsAt' | 'isolatePart' | 'isolatedPartId' | 'setPartDisplay' | 'getPartDisplay'> & {parts:Map<string,any>;modelRoot:THREE.Group;sketchSurface:unknown};
}
it('picks each visible body once, nearest first, never hidden or previewed geometry',()=>{
 const v=fixture();expect(v.contextPartsAt(300,300).map(x=>x.partId)).toEqual(['near','far']);
 v.parts.get('near').group.visible=false;expect(v.contextPartsAt(300,300).map(x=>x.partId)).toEqual(['far']);
 v.modelRoot.visible=false;expect(v.contextPartsAt(300,300)).toEqual([]);
 v.modelRoot.visible=true;v.sketchSurface={};expect(v.contextPartsAt(300,300)).toEqual([]);
});
it('temporary isolation restores the preexisting hidden states',()=>{
 const v=fixture();v.parts.get('far').visible=false;v.parts.get('far').group.visible=false;v.isolatePart('near');
 expect(v.isolatedPartId).toBe('near');expect(v.parts.get('far').group.visible).toBe(false);
 v.isolatePart(null);expect(v.parts.get('near').group.visible).toBe(true);expect(v.parts.get('far').group.visible).toBe(false);
});
it('changes only the target materials, keeps independent overrides and resets to the scene defaults',()=>{
 const v=fixture(),other=v.parts.get('far').surface.material[0],original=other.color.getHex();
 v.setPartDisplay('near',{color:'#ff3344',opacity:.3,roughness:.2,metalness:.6,edgeColor:'#225588',edgeWidthPx:4,edgeOpacity:.8});
 const own=v.parts.get('near').surface.material[0];
 expect(own.color.getHex()).toBe(0xff3344);expect(own.opacity).toBe(.3);expect(own.transparent).toBe(true);expect(own.depthWrite).toBe(false);
 expect(other.color.getHex()).toBe(original);expect(other.opacity).toBe(1);
 expect(v.parts.get('near').edges.material.color.getHex()).toBe(0x225588);
 expect(v.parts.get('near').edges.material.linewidth).toBe(4);expect(v.parts.get('near').edges.material.opacity).toBe(.8);
 v.setPartDisplay('near',{});expect(own.opacity).toBe(resolveAppearance(defaultCADAppearance).bodyOpacity);
 expect(v.parts.get('near').edges.material.linewidth).toBe(resolveAppearance(defaultCADAppearance).edgeWidth);
});
it('does not carry appearance to another document with the same body ID',()=>{
 const v=fixture();v.setPartDisplay('near',{opacity:.3});v.parts.get('near').data.sourceDocumentId='another-doc';
 expect(v.getPartDisplay('near')).toEqual({});
 v.setPartDisplay('near',{});expect(v.parts.get('near').surface.material[0].opacity).toBe(1);
});
it('individual overrides retain the environment and inherit unspecified finish settings',()=>{
 const base=resolveAppearance(defaultCADAppearance),next=resolvePartDisplay(base,{color:'#112233',opacity:.4,roughness:.2});
 expect(next).toMatchObject({background:base.background,bodyColor:0x112233,bodyOpacity:.4,finish:{roughness:.2,metalness:base.finish.metalness}});
 expect(base.bodyColor).not.toBe(0x112233);
});

it('selects original native faces through material preview only for an active face picker',()=>{
 const v=fixture() as any;v.featurePreview={active:true};v.modelRoot.visible=false;
 for(const part of v.parts.values())part.topology=new Map([[1,{id:1,surfaceType:'PLANE',candidates:[]}]]);
 const old=cadSelection.snapshot().filter;
 try{
  cadSelection.dispatch({type:'set-filter',filter:'face'});
  expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();
  v.setSourceFacePicking(true);expect(v.selectionHit({clientX:300,clientY:300}).item).toMatchObject({kind:'face',partId:'near',faceId:1});
  cadSelection.dispatch({type:'set-filter',filter:'body'});expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();
  v.setSourceBodyPicking(true);expect(v.selectionHit({clientX:300,clientY:300}).item).toMatchObject({kind:'body',partId:'near'});v.setSourceFacePicking(true);
  cadSelection.dispatch({type:'set-filter',filter:'face'});v.historyEditing=true;expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();
  v.historyEditing=false;v.setSourceFacePicking(false);expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();
 }finally{cadSelection.dispatch({type:'set-filter',filter:old});}
});

it('allows source vertices during previews only while the point picker owns selection',()=>{
 const v=fixture() as any;v.featurePreview={active:true};v.modelRoot.visible=false;
 for(const part of v.parts.values())part.topology=new Map([[1,{id:1,surfaceType:'PLANE',candidates:[{id:'v',kind:'vertex',label:'Corner',origin:[0,0,.5]}]}]]);
 const old=cadSelection.snapshot().filter;
 try{
  cadSelection.dispatch({type:'set-filter',filter:'vertex'});
  expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();v.setSourceVertexPicking(true);
  expect(v.selectionHit({clientX:300,clientY:300}).item).toMatchObject({kind:'vertex',partId:'near'});
  cadSelection.dispatch({type:'set-filter',filter:'body'});expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();
  cadSelection.dispatch({type:'set-filter',filter:'vertex'});v.setSourceVertexPicking(false);expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();
 }finally{cadSelection.dispatch({type:'set-filter',filter:old});}
});

it('allows anchored source-edge picks through preview only for an active edge picker',()=>{
 const v=fixture() as any;v.featurePreview={active:true};v.modelRoot.visible=false;
 const candidate={id:'e',kind:'edge-midpoint',label:'Straight edge',origin:[0,0,.5],edgeAnchor:{start:{signature:'a'},end:{signature:'b'}},measurements:{linearDirection:[0,1,0]}};
 for(const part of v.parts.values()){part.topology=new Map([[1,{id:1,surfaceType:'PLANE',candidates:[candidate]}]]);part.data.topology=[...part.topology.values()];}
 const old=cadSelection.snapshot().filter;
 try{
  cadSelection.dispatch({type:'set-filter',filter:'edge'});expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();v.setSourceEdgePicking(true);
  const hit=v.selectionHit({clientX:300,clientY:300});expect(hit.item).toMatchObject({kind:'edge',partId:'near'});
  cadSelection.dispatch({type:'replace',items:[hit.item]});expect(v.selectedTransformEdge('doc')).toEqual({bodyId:'near',label:hit.item.label,anchor:candidate.edgeAnchor});
  expect(v.selectedTransformEdge('other')).toBeNull();v.parts.get('near').data.geometryKind='mesh';expect(v.selectedTransformEdge('doc')).toBeNull();delete v.parts.get('near').data.geometryKind;
  delete (candidate as any).measurements.linearDirection;expect(v.selectedTransformEdge('doc')).toBeNull();
  v.setSourceEdgePicking(false);expect(v.selectionHit({clientX:300,clientY:300})).toBeNull();
 }finally{cadSelection.dispatch({type:'clear'});cadSelection.dispatch({type:'set-filter',filter:old});}
});
