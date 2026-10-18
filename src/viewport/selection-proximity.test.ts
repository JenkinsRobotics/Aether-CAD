import {expect,it} from 'vitest';
import * as THREE from 'three/webgpu';
import type {ConnectorCandidate} from '../aether-core';
import {selectionCandidateDistance} from './selection-proximity';
const edge={id:'e',faceId:1,label:'Edge',xAxis:[1,0,0],yAxis:[0,1,0],zAxis:[0,0,1],kind:'edge-midpoint',origin:[0,0,0],measurements:{linearDirection:[1,0,0],lengthMillimeters:100}} as ConnectorCandidate;
const project=(p:THREE.Vector3)=>({x:p.x,y:p.y});
it('measures distance along the whole straight edge, after placement',()=>{
 const matrix=new THREE.Matrix4().makeTranslation(200,10,0);
 expect(selectionCandidateDistance(edge,matrix,{x:240,y:13},project)).toBe(3);
 expect(selectionCandidateDistance(edge,matrix,{x:270,y:10},project)).toBe(20);
});
it('uses point distance for vertices and ignores clipped candidates',()=>{
 const vertex={...edge,kind:'vertex'} as ConnectorCandidate;
 expect(selectionCandidateDistance(vertex,new THREE.Matrix4(),{x:3,y:4},project)).toBe(5);
 expect(selectionCandidateDistance(edge,new THREE.Matrix4(),{x:0,y:0},()=>null)).toBe(Infinity);
});
