import {expect,it} from 'vitest';
import * as THREE from 'three/webgpu';
import {itemsInsideLasso,pointInLasso} from './freeform-selection';
import type {SelectablePart} from './box-selection';
const p=(x:number,y:number)=>({x,y});
const square=[p(0,0),p(10,0),p(10,10),p(0,10)];
const flat=(v:THREE.Vector3)=>p(v.x,v.y);
function part(vertices:number[],visible=true):SelectablePart {
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
 return {data:{id:'a',name:'Part'},group:{visible,matrixWorld:new THREE.Matrix4()},surface:new THREE.Mesh(geometry) as never,
 faceRanges:[{faceId:7,start:0,count:vertices.length/3}],topology:new Map([[7,{id:7,surfaceType:'PLANE',candidates:[{id:'v',kind:'vertex',origin:[2,2,0],label:'Vertex'},{id:'e',kind:'edge-midpoint',origin:[4,4,0],label:'Edge'}]} as never]])};
}
it('handles concave outlines, their boundaries and holes in the bounding rectangle',()=>{
 const l=[p(0,0),p(10,0),p(10,2),p(2,2),p(2,10),p(0,10)];
 expect(pointInLasso(p(1,8),l)).toBe(true);expect(pointInLasso(p(8,8),l)).toBe(false);expect(pointInLasso(p(2,8),l)).toBe(true);
 expect(itemsInsideLasso([part([7,7,0,9,7,0,7,9,0])],'body',l,flat)).toEqual([]);
});
it('selects an enclosed triangle, enclosed lasso, or crossing edge',()=>{
 for(const vertices of [[1,1,0,2,1,0,1,2,0],[-50,-50,0,100,-50,0,-50,100,0],[-3,4,0,13,4,0,13,5,0]])
  expect(itemsInsideLasso([part(vertices)],'body',square,flat).map(i=>i.id)).toEqual(['body:a']);
});
it('skips hidden and behind-camera geometry and rejects tiny gestures',()=>{
 const triangle=[1,1,0,2,1,0,1,2,0];
 expect(itemsInsideLasso([part(triangle,false)],'body',square,flat)).toEqual([]);
 expect(itemsInsideLasso([part(triangle)],'body',square,()=>null)).toEqual([]);
 expect(itemsInsideLasso([part(triangle)],'body',[p(0,0),p(10,0)],flat)).toEqual([]);
});
it('returns actual face, edge and vertex identities and respects placement',()=>{
 const a=part([1,1,0,2,1,0,1,2,0]);
 expect(itemsInsideLasso([a],'face',square,flat)[0]).toMatchObject({id:'face:a:7',faceId:7});
 expect(itemsInsideLasso([a],'edge',square,flat)[0].id).toBe('edge:a:e');
 expect(itemsInsideLasso([a],'vertex',square,flat)[0].id).toBe('vertex:a:v');
 a.group.matrixWorld.makeTranslation(100,100,0);
 expect(itemsInsideLasso([a],'face',square,flat)).toEqual([]);
});
