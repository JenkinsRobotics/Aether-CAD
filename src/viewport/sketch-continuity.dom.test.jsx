import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { defaultCADAppearance } from '../cad-appearance-store';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, MateViewport;
beforeAll(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
  for(const key of ['window','document','Element','HTMLElement'])vi.stubGlobal(key,dom.window[key]);
  MateViewport=(await import('../viewer')).MateViewport;
});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});

// Use the actual surface lifecycle with real Three scenes/cameras and DOM,
// skipping only GPU startup. Changing a plane must not create a new world.
it.each(['none','grid','floor','both'])('preserves %s and camera/model context through sketch plane changes',mode=>{
  const viewer=Object.create(MateViewport.prototype);
  viewer.appearance={...defaultCADAppearance,floorMode:mode};
  viewer.grid=new THREE.Group();viewer.floor=new THREE.Group();
  viewer.modelRoot=new THREE.Group();viewer.referenceRoot=new THREE.Group();
  const shown=new THREE.Group(),hidden=new THREE.Group();hidden.visible=false;
  viewer.modelRoot.add(shown,hidden);
  const reference=new THREE.Group();viewer.referenceRoot.add(reference);
  viewer.scene=new THREE.Scene();viewer.scene.background=new THREE.Color('#324556');
  viewer.scene.add(viewer.grid,viewer.floor,viewer.modelRoot,viewer.referenceRoot);
  viewer.cssScene=new THREE.Scene();viewer.cssRenderer={};viewer.sketchSurface=null;
  viewer.renderer={domElement:document.createElement('canvas')};
  viewer.camera=new THREE.PerspectiveCamera();viewer.camera.position.set(180,-220,140);
  viewer.camera.up.set(0,0,1);viewer.camera.lookAt(0,0,0);
  viewer.controls={target:new THREE.Vector3(10,20,30),update:vi.fn()};
  viewer.applyFloorVisibility();
  const state=()=>({grid:viewer.grid.visible,floor:viewer.floor.visible,
    shown:shown.visible,hidden:hidden.visible,reference:reference.visible,
    background:viewer.scene.background.getHexString(),position:viewer.camera.position.toArray(),
    rotation:viewer.camera.quaternion.toArray(),target:viewer.controls.target.toArray()});
  const original=state(), scene=viewer.scene;
  for(const frame of [
    {originMillimeters:[0,0,0],xDirection:[1,0,0],normal:[0,0,1]},
    {originMillimeters:[0,20,0],xDirection:[1,0,0],normal:[0,-1,0]},
  ]) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    viewer.beginSketchSurface(frame,svg,{x:-100,y:-100,width:200,height:200});
    expect(viewer.scene).toBe(scene);expect(state()).toEqual(original);
    expect(viewer.sketchSurface.origin.toArray()).toEqual(frame.originMillimeters);
    expect(viewer.cssScene.children).toHaveLength(1);
    // Appearance edits while sketching must obey the selected floor mode too.
    viewer.applyFloorVisibility();expect(state()).toEqual(original);
  }
  // A user change during sketching must survive finishing/canceling.
  viewer.appearance.floorMode=mode==='both'?'none':'both';viewer.applyFloorVisibility();
  const changed=state();viewer.endSketchSurface();
  expect(state()).toEqual(changed);expect(viewer.cssScene.children).toHaveLength(0);
});
