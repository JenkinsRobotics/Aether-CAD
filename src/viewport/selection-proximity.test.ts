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
it('measures distance along a circular arc, not only to its midpoint',()=>{
 // A quarter arc of radius 100 about Z, centred at the origin, from +x to +y: midpoint at 45°.
 const arc={...edge,origin:[100*Math.SQRT1_2,100*Math.SQRT1_2,0],measurements:{centerMillimeters:[0,0,0],axisDirection:[0,0,1],radiusMillimeters:100,lengthMillimeters:Math.PI*50}} as ConnectorCandidate;
 expect(selectionCandidateDistance(arc,new THREE.Matrix4(),{x:100,y:3},project)).toBeLessThan(4); // near its start
 expect(selectionCandidateDistance(arc,new THREE.Matrix4(),{x:3,y:100},project)).toBeLessThan(4); // near its end
 expect(selectionCandidateDistance(arc,new THREE.Matrix4(),{x:0,y:0},project)).toBeCloseTo(100,0); // the centre is a radius away
 expect(selectionCandidateDistance(arc,new THREE.Matrix4(),{x:-100,y:0},project)).toBeGreaterThan(100); // the far side is not part of the arc
});
