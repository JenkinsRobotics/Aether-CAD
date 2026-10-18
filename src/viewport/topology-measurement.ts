import {Matrix3, Matrix4, Vector3} from 'three';
import type {TopologyMeasurements, Vec3} from '@aether/core/contracts';

export type SelectedTopologyMeasurement = TopologyMeasurements & {id:string;label:string;kind:string};

/** Analytic values are in part coordinates; display vectors in the model frame. */
export function measurementsInWorld(measurements:TopologyMeasurements, matrix:Matrix4):TopologyMeasurements {
  return {
    ...measurements,
    ...(measurements.centerMillimeters ? {centerMillimeters:new Vector3(...measurements.centerMillimeters).applyMatrix4(matrix).toArray() as [number,number,number]} : {}),
    ...(measurements.linearDirection ? {linearDirection:new Vector3(...measurements.linearDirection).transformDirection(matrix).toArray() as [number,number,number]} : {}),
    ...(measurements.planarNormal ? {planarNormal:new Vector3(...measurements.planarNormal).applyNormalMatrix(new Matrix3().getNormalMatrix(matrix)).toArray() as [number,number,number]} : {}),
  };
}

/** Unoriented acute angle; never substitute an arbitrary curve tangent. */
export function selectedTopologyAngle(selected:readonly SelectedTopologyMeasurement[]):{radians:number;label:string}|null {
  if(selected.length!==2)return null;
  const vectors=selected.map(item=>item.kind==='edge'?item.linearDirection:item.kind==='face'?item.planarNormal:undefined);
  const valid=(vector:Vec3|undefined):vector is Vec3=>!!vector && vector.length===3 && vector.every(Number.isFinite) && Math.hypot(...vector)>1e-12;
  if(!valid(vectors[0]) || !valid(vectors[1]))return null;
  const [a,b]=vectors;
  const dot=Math.min(1,Math.max(0,Math.abs(a.reduce((sum,value,index)=>sum+value*b[index],0)/(Math.hypot(...a)*Math.hypot(...b)))));
  const mixed=selected[0].kind!==selected[1].kind;
  return {
    radians:mixed?Math.asin(dot):Math.acos(dot),
    label:mixed?'Edge-to-plane angle':selected[0].kind==='face'?'Angle between planes':'Angle between straight edges',
  };
}
