import { expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { clipSegments, SectionLayer } from "./section-layer";

const top = { label: "Top", originMillimeters: [0, 0, 0], normal: [0, 0, 1] } as const;

it("cuts edge segments at the section plane and keeps only the remaining side", () => {
  // Keep z ≤ 0 (normal −Z, constant 0).
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  expect(clipSegments([0, 0, -2, 0, 0, 2, 1, 1, 1, 1, 1, 3, 5, 5, -1, 5, 5, -4], plane)).toEqual([0, 0, -2, 0, 0, 0, 5, 5, -1, 5, 5, -4]);
});

it('combines all enabled planes for geometry, picking and body scope',()=>{
  const root=new THREE.Group(),overlay=new THREE.Group(),layer=new SectionLayer(root,overlay),group=new THREE.Group();
  layer.adopt('body',group,new THREE.BoxGeometry(20,20,20));
  const view={planes:[{id:'z',plane:top,offsetMillimeters:0},{id:'x',plane:{label:'Right',originMillimeters:[0,0,0] as const,normal:[1,0,0] as const},offsetMillimeters:0}],activePlaneId:'x',mode:'exclude' as const,items:[]};
  layer.apply(view,[group],new THREE.Box3(new THREE.Vector3(-10,-10,-10),new THREE.Vector3(10,10,10)),true);
  expect(layer.clipped.clippingPlanes).toHaveLength(2);expect(overlay.children.filter(child=>child.visible)).toHaveLength(2);
  expect(layer.hides('body',new THREE.Vector3(5,0,-5))).toBe(true);expect(layer.hides('body',new THREE.Vector3(-5,0,5))).toBe(true);
  expect(layer.hides('body',new THREE.Vector3(-5,0,-5))).toBe(false);
  layer.apply({...view,planes:view.planes.map(cut=>({...cut,enabled:cut.id==='z'}))},[group],new THREE.Box3(),false);
  expect(layer.hides('body',new THREE.Vector3(5,0,-5))).toBe(false);
  layer.apply({...view,items:[{id:'body',label:'Body'}]},[group],new THREE.Box3(),false);
  expect(layer.capOf(group)).toBeUndefined();expect(layer.hides('body',new THREE.Vector3(5,0,5))).toBe(false);
});

it("clips a part's edges while it is sectioned and restores them when the section ends", () => {
  const root = new THREE.Group(), layer = new SectionLayer(root, new THREE.Group());
  const group = new THREE.Group(); group.position.z = 10; group.updateMatrixWorld(true);
  const shown: number[][] = [], positions = [0, 0, -5, 0, 0, 5];
  layer.adopt("p", group, new THREE.BoxGeometry(), { show: (p: ArrayLike<number>) => shown.push(Array.from(p)), positions });
  // The section at world z = 10 (the part's own z = 0) keeps the lower half.
  layer.apply({ planes:[{id:"top",plane:top,offsetMillimeters:10}],activePlaneId:"top",mode:"exclude",items:[] }, [group], new THREE.Box3(), false);
  expect(shown.at(-1)).toEqual([0, 0, -5, 0, 0, 0]);
  expect(group.parent).toBe(layer.clipped);
  layer.apply(null, [group], new THREE.Box3(), false);
  expect(shown.at(-1)).toEqual(positions);
  expect(group.parent).toBe(root);
});
