import {describe,expect,it} from 'vitest';
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

const clipped = (p: THREE.Vector3) => (p.z > 50 ? null : { x: p.x, y: p.y });
const identity = new THREE.Matrix4();
const clippedEdge = (extra: Partial<ConnectorCandidate>): ConnectorCandidate => ({
  id: 'e', faceId: 1, kind: 'edge-midpoint', label: 'Edge', origin: [50, 0, 0],
  xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], ...extra,
} as ConnectorCandidate);

describe('selection distance to an edge', () => {
  it('measures to the nearest visible part of a polyline whose far samples do not project', () => {
    // A rim from x=0 to x=100 along y=0 whose second half sits behind the camera (z=100).
    const polyline = [0, 0, 0, 25, 0, 0, 50, 0, 0, 75, 0, 100, 100, 0, 100];
    const d = selectionCandidateDistance(clippedEdge({ polylineMillimeters: polyline }), identity, { x: 30, y: 5 }, clipped);
    expect(d).toBeCloseTo(5);
  });
  it('still measures a straight edge when one endpoint is behind the camera', () => {
    const line = clippedEdge({ origin: [50, 0, 50], measurements: { lengthMillimeters: 100, linearDirection: [0, 0, 1] } });
    // The edge runs from z=0 to z=100 at x=50; only the z<=50 half projects, all onto (50, 0).
    expect(selectionCandidateDistance(line, identity, { x: 53, y: 4 }, clipped)).toBeCloseTo(5);
  });
  it('is infinite only when nothing of the edge is visible', () => {
    const hidden = clippedEdge({ polylineMillimeters: [0, 0, 100, 50, 0, 100] });
    expect(selectionCandidateDistance(hidden, identity, { x: 0, y: 0 }, clipped)).toBe(Infinity);
  });
});
