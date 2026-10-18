import {expect,it} from 'vitest';
import {Matrix4} from 'three';
import {measurementsInWorld,selectedTopologyAngle,type SelectedTopologyMeasurement} from './topology-measurement';

const edge=(direction:readonly [number,number,number]):SelectedTopologyMeasurement=>({id:'edge',label:'Edge',kind:'edge',linearDirection:direction});
const face=(normal:readonly [number,number,number]):SelectedTopologyMeasurement=>({id:'face',label:'Face',kind:'face',planarNormal:normal});
it('measures acute straight-edge and planar angles independently of orientation',()=>{
  expect(selectedTopologyAngle([edge([1,0,0]),edge([1,1,0])])?.radians).toBeCloseTo(Math.PI/4);
  expect(selectedTopologyAngle([edge([-1,0,0]),edge([1,1,0])])?.radians).toBeCloseTo(Math.PI/4);
  expect(selectedTopologyAngle([face([0,0,1]),face([0,1,0])])?.radians).toBeCloseTo(Math.PI/2);
  expect(selectedTopologyAngle([face([0,0,1]),face([0,0,-1])])?.radians).toBe(0);
});
it('measures the edge against the plane rather than its normal',()=>{
  expect(selectedTopologyAngle([edge([1,0,0]),face([0,0,1])])?.radians).toBe(0);
  expect(selectedTopologyAngle([face([0,0,1]),edge([0,0,1])])?.radians).toBeCloseTo(Math.PI/2);
  expect(selectedTopologyAngle([edge([Math.sqrt(3),0,1]),face([0,0,1])])?.radians).toBeCloseTo(Math.PI/6);
});
it('uses positioned part directions and leaves native measurements immutable',()=>{
  const original=edge([1,0,0]);
  const matrix=new Matrix4().makeRotationZ(Math.PI/6).setPosition(100,200,300);
  const moved=measurementsInWorld(original,matrix);
  expect(selectedTopologyAngle([original,{...original,...moved}])?.radians).toBeCloseTo(Math.PI/6);
  expect(original.linearDirection).toEqual([1,0,0]);
  const plane=measurementsInWorld({planarNormal:[0,0,1]},new Matrix4().makeRotationX(Math.PI/3));
  expect(selectedTopologyAngle([face([0,0,1]),{...face([0,0,1]),...plane}])?.radians).toBeCloseTo(Math.PI/3);
});
it('refuses curved, absent, zero, nonfinite and oversized selections',()=>{
  for(const invalid of [{id:'curve',label:'Circle',kind:'edge',radiusMillimeters:10},edge([0,0,0]),edge([NaN,0,1]),{...face([1,0,0]),planarNormal:undefined}]) {
    expect(selectedTopologyAngle([edge([1,0,0]),invalid])).toBeNull();
  }
  expect(selectedTopologyAngle([edge([1,0,0])])).toBeNull();
  expect(selectedTopologyAngle([edge([1,0,0]),edge([1,0,0]),face([0,0,1])])).toBeNull();
});
