import {expect,it,vi,afterEach} from 'vitest';
import * as THREE from 'three/webgpu';
import {createEmptyPartDocument} from '@aether/core/document';
import {RegionPicker} from './region-picker';
afterEach(()=>vi.unstubAllGlobals());
it('picks open non-construction curves by their actual line and clears them when Thin mode ends',()=>{
 const bus=new EventTarget();vi.stubGlobal('window',bus);
 const doc=createEmptyPartDocument('Curves');doc.features.push({id:'s',name:'Open sketch',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[20,0]}]},{type:'path',construction:true,start:[0,5],segments:[{type:'line',end:[20,5]}]}]}});
 const picker=new RegionPicker();picker.setDocument(doc);
 bus.dispatchEvent(new CustomEvent('aether-region-mode',{detail:{active:true,curveMode:false,allowedSourceIds:['s']}}));expect(picker.group.children).toHaveLength(0);
 bus.dispatchEvent(new CustomEvent('aether-region-mode',{detail:{active:true,curveMode:true,allowedSourceIds:['s']}}));expect(picker.group.children).toHaveLength(1);expect(picker.group.children[0]).toBeInstanceOf(THREE.Line);
 const received=vi.fn();bus.addEventListener('aether-region-picked',received);
 const ray=new THREE.Raycaster(new THREE.Vector3(10,0,100),new THREE.Vector3(0,0,-1));ray.params.Line.threshold=.2;
 expect(picker.pick(ray)).toBe(true);expect(received.mock.calls[0][0].detail).toEqual({featureId:'s',contourIndex:0});
 ray.ray.origin.y=5;expect(picker.pick(ray)).toBe(false);
 const geometry=(picker.group.children[0] as THREE.Line).geometry;const dispose=vi.spyOn(geometry,'dispose');
 bus.dispatchEvent(new CustomEvent('aether-region-mode',{detail:{active:false}}));expect(picker.group.children).toHaveLength(0);expect(dispose).toHaveBeenCalledOnce();
});

it('picks a joined face and its nested circle in 3D, while Thin keeps the five original curves',()=>{
 const bus=new EventTarget();vi.stubGlobal('window',bus);
 const doc=createEmptyPartDocument('Joined face');
 const corners:[number,number][]=[[0,0],[20,0],[20,10],[0,10]];
 doc.features.push({id:'s',name:'Joined sketch',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[
  ...corners.map((start,i)=>({type:'path' as const,start,segments:[{type:'line' as const,end:corners[(i+1)%4]}]})),
  {type:'circle',center:[10,5],radius:2},
 ]}});
 const picker=new RegionPicker();picker.setDocument(doc);
 bus.dispatchEvent(new CustomEvent('aether-region-mode',{detail:{active:true,regionMode:true,allowedSourceIds:['s']}}));
 expect(picker.group.children).toHaveLength(2);expect(picker.group.children.every(c=>c instanceof THREE.Mesh)).toBe(true);
 const received=vi.fn();bus.addEventListener('aether-region-picked',received);
 const ray=new THREE.Raycaster(new THREE.Vector3(2,2,100),new THREE.Vector3(0,0,-1));
 expect(picker.pick(ray)).toBe(true);expect(received.mock.calls.at(-1)![0].detail).toEqual({featureId:'s',contourIndex:0});
 ray.ray.origin.set(10,5,100);expect(picker.pick(ray)).toBe(true);
 expect(received.mock.calls.at(-1)![0].detail).toEqual({featureId:'s',contourIndex:4});
 ray.ray.origin.set(30,5,100);expect(picker.pick(ray)).toBe(false);
 const geometries=picker.group.children.map(c=>vi.spyOn((c as THREE.Mesh).geometry,'dispose'));
 bus.dispatchEvent(new CustomEvent('aether-region-mode',{detail:{active:true,curveMode:true,allowedSourceIds:['s']}}));
 expect(picker.group.children).toHaveLength(5);expect(picker.group.children.every(c=>c instanceof THREE.Line)).toBe(true);
 geometries.forEach(dispose=>expect(dispose).toHaveBeenCalledOnce());
 bus.dispatchEvent(new CustomEvent('aether-region-mode',{detail:{active:false}}));expect(picker.group.children).toHaveLength(0);
});
